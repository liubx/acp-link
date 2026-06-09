//! 微信平台的 [`IMChannel`](crate::im::IMChannel) 实现（动态多账号）
//!
//! 所有账号信息统一存储在 `~/.acp-link/wechat/tokens.json`。
//! 启动时自动加载已有账号，并持续提供扫码入口添加新账号。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::{mpsc, RwLock};

use super::client::{ParsedWechatMessage, TokenStore, WechatClient, WechatMessageContent};
use crate::im::{IMChannel, ImMessage, ImMessageContent, TopicSubmission};

#[derive(Debug, Clone)]
struct UserContext {
    context_token: String,
    account_id: String,
}

/// 微信平台 IMChannel 实现
#[derive(Clone)]
pub struct WechatChannel {
    /// account_id → client
    clients: Arc<RwLock<HashMap<String, WechatClient>>>,
    /// 微信 user_id → 上下文
    user_contexts: Arc<RwLock<HashMap<String, UserContext>>>,
    /// 最近收到的消息缓存：topic_id → 最新消息内容（用于 aggregate_topic）
    recent_messages: Arc<RwLock<HashMap<String, RecentMessage>>>,
    /// 待登录的账号名称列表
    pending_accounts: Arc<RwLock<Vec<String>>>,
    store: TokenStore,
}

/// 缓存的最近消息
#[derive(Debug, Clone)]
struct RecentMessage {
    text: Option<String>,
    message_id: String,
    image_key: Option<String>,
    file_key: Option<String>,
    file_name: Option<String>,
}

impl WechatChannel {
    /// 创建 WechatChannel
    ///
    /// `accounts`: 配置中声明的期望账号名称列表
    pub fn new(accounts: &[String]) -> Self {
        let root = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".acp-link")
            .join("wechat");
        std::fs::create_dir_all(&root).ok();

        let store = TokenStore::new(&root);
        let tokens = store.load_all();

        let mut clients = HashMap::new();
        for td in &tokens {
            if td.account_id.is_empty() {
                continue;
            }
            let label = if td.name.is_empty() { &td.account_id } else { &td.name };
            let client = WechatClient::from_token(td, store.clone());
            tracing::info!("加载微信账号: {label}");
            clients.insert(td.account_id.clone(), client);
        }

        // 找出配置中声明但 tokens.json 里没有的账号
        let existing_names: Vec<String> = tokens.iter().map(|t| t.name.clone()).collect();
        let missing: Vec<String> = accounts
            .iter()
            .filter(|name| !existing_names.contains(name))
            .cloned()
            .collect();

        if !missing.is_empty() {
            tracing::info!("以下账号需要扫码登录: {:?}", missing);
        }

        let count = clients.len();
        if count > 0 {
            tracing::info!("微信 ClawBot: 已加载 {count} 个账号");
        }

        Self {
            clients: Arc::new(RwLock::new(clients)),
            user_contexts: Arc::new(RwLock::new(HashMap::new())),
            recent_messages: Arc::new(RwLock::new(HashMap::new())),
            store,
            pending_accounts: Arc::new(RwLock::new(missing)),
        }
    }

    /// 扫码登录新账号
    async fn login_new(&self, name: &str) -> anyhow::Result<(String, WechatClient)> {
        let client = WechatClient::new_unauthenticated(self.store.clone());
        let td = client.login(name).await?;
        let acct = td.account_id.clone();
        self.clients.write().await.insert(acct.clone(), client.clone());
        Ok((acct, client))
    }

    fn spawn_listener(&self, account_id: String, client: WechatClient, tx: mpsc::Sender<ImMessage>) -> tokio::task::JoinHandle<anyhow::Result<()>> {
        let contexts = self.user_contexts.clone();
        let recent = self.recent_messages.clone();
        tokio::spawn(async move {
            tracing::info!("[{account_id}] 开始监听");
            let (inner_tx, mut inner_rx) = mpsc::channel::<ParsedWechatMessage>(256);
            let fwd_tx = tx;
            let fwd_ctx = contexts;
            let fwd_recent = recent;
            let fwd_id = account_id.clone();
            let fwd = tokio::spawn(async move {
                // 延迟窗口：收到文字后等 2 秒看有没有附件一起来
                let mut pending_text: Option<ParsedWechatMessage> = None;
                let delay = tokio::time::Duration::from_secs(2);

                loop {
                    let msg = if pending_text.is_some() {
                        // 有文字待发，带超时等下一条
                        match tokio::time::timeout(delay, inner_rx.recv()).await {
                            Ok(Some(m)) => Some(m),
                            Ok(None) => break, // channel closed
                            Err(_) => None,    // 超时，flush pending text
                        }
                    } else {
                        inner_rx.recv().await
                    };

                    // 超时：flush 之前缓冲的文字消息
                    if msg.is_none() && pending_text.is_some() {
                        let text_msg = pending_text.take().unwrap();
                        process_and_forward(&text_msg, &fwd_ctx, &fwd_recent, &fwd_id, &fwd_tx).await;
                        continue;
                    }

                    let Some(msg) = msg else { break };

                    let is_text = matches!(&msg.content, WechatMessageContent::Text(_));

                    if is_text {
                        // 如果之前有缓冲的文字（不同用户或连续文字），先 flush 旧的
                        if let Some(prev) = pending_text.take() {
                            process_and_forward(&prev, &fwd_ctx, &fwd_recent, &fwd_id, &fwd_tx).await;
                        }
                        // 缓冲新文字，等 2 秒看有没有附件跟着
                        pending_text = Some(msg);
                    } else {
                        // 非文字（图片/文件）：先转发它（作为 pending attachment），
                        // 然后如果有缓冲的文字就继续等（图片到了说明可能还有更多）
                        process_and_forward(&msg, &fwd_ctx, &fwd_recent, &fwd_id, &fwd_tx).await;
                    }
                }

                // flush 残留
                if let Some(text_msg) = pending_text.take() {
                    process_and_forward(&text_msg, &fwd_ctx, &fwd_recent, &fwd_id, &fwd_tx).await;
                }
            });
            let result = client.listen(inner_tx).await;
            fwd.abort();
            if let Err(ref e) = result { tracing::error!("[{account_id}] 退出: {e}"); }
            result
        })
    }

    async fn resolve_client(&self, user_id: &str) -> anyhow::Result<(WechatClient, String)> {
        let ctx = self.user_contexts.read().await;
        let uc = ctx.get(user_id).ok_or_else(|| anyhow::anyhow!("用户 {user_id} 无上下文"))?;
        let clients = self.clients.read().await;
        let client = clients.get(&uc.account_id).ok_or_else(|| anyhow::anyhow!("账号 {} 不存在", uc.account_id))?;
        Ok((client.clone(), uc.context_token.clone()))
    }
}

#[async_trait]
impl IMChannel for WechatChannel {
    fn platform_name(&self) -> &str { "wechat" }

    async fn listen(&self, tx: mpsc::Sender<ImMessage>) -> anyhow::Result<()> {
        // 先启动已有 token 的账号监听
        let snapshot = self.clients.read().await.clone();
        let mut handles = Vec::new();
        for (id, client) in &snapshot {
            handles.push(self.spawn_listener(id.clone(), client.clone(), tx.clone()));
        }

        // 为缺少 token 的账号依次扫码，每个扫完立即启动监听
        let pending = self.pending_accounts.read().await.clone();
        for name in &pending {
            println!("=== 微信 ClawBot: 请为 [{name}] 扫码登录 ===");
            match self.login_new(name).await {
                Ok((id, client)) => {
                    handles.push(self.spawn_listener(id.clone(), client.clone(), tx.clone()));
                    self.clients.write().await.insert(id, client);
                }
                Err(e) => {
                    eprintln!("[{name}] 登录失败: {e}");
                }
            }
        }
        self.pending_accounts.write().await.clear();

        if handles.is_empty() {
            anyhow::bail!("没有任何微信账号可用，请检查配置或重新扫码");
        }

        // 等待监听 tasks
        let (result, _, rest) = futures::future::select_all(handles).await;
        for h in rest { h.abort(); }
        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e),
            Err(e) => Err(anyhow::anyhow!("task panic: {e}")),
        }
    }

    async fn reply_message(&self, message_id: &str, _markdown: &str) -> anyhow::Result<(String, String)> {
        let (uid, _) = parse_mid(message_id);
        // 后台发 typing（best effort）
        if let Ok((c, ct)) = self.resolve_client(&uid).await {
            let c2 = c.clone();
            let uid2 = uid.clone();
            let ct2 = ct.clone();
            tokio::spawn(async move {
                if let Ok(Some(ticket)) = c2.get_typing_ticket(&uid2, &ct2).await {
                    let _ = c2.send_typing(&uid2, &ticket, 1).await;
                }
            });
        }
        let new_msg_id = format!("{uid}:reply");
        Ok((new_msg_id, uid))
    }

    async fn update_message(&self, message_id: &str, markdown: &str) -> anyhow::Result<()> {
        let (uid, _) = parse_mid(message_id);
        let (c, ct) = self.resolve_client(&uid).await?;
        // 上层已保证微信平台只在流结束时调一次，直接发
        c.send_text(&uid, markdown, &ct).await?;
        Ok(())
    }

    async fn download_resource(&self, _mid: &str, file_key: &str, _rt: &str) -> anyhow::Result<Vec<u8>> {
        let media: super::client::CDNMedia = serde_json::from_str(file_key)?;
        let clients = self.clients.read().await;
        let c = clients.values().next().ok_or_else(|| anyhow::anyhow!("无可用账号"))?;
        c.download_media(&media).await
    }

    async fn aggregate_topic(&self, _tid: &str, cid: &str) -> anyhow::Result<TopicSubmission> {
        // 微信无 thread 聚合，返回最近缓存的那条消息
        let recent = self.recent_messages.read().await;
        let mut texts = vec![];
        let mut images = vec![];
        let mut files = vec![];

        if let Some(msg) = recent.get(cid) {
            if let Some(ref t) = msg.text {
                texts.push(t.clone());
            }
            if let Some(ref key) = msg.image_key {
                images.push(crate::im::ImageItem {
                    message_id: msg.message_id.clone(),
                    image_key: key.clone(),
                });
            }
            if let Some(ref key) = msg.file_key {
                files.push(crate::im::FileItem {
                    message_id: msg.message_id.clone(),
                    file_key: key.clone(),
                    file_name: msg.file_name.clone().unwrap_or_default(),
                });
            }
        }

        Ok(TopicSubmission {
            topic_id: cid.into(),
            chat_id: cid.into(),
            texts,
            images,
            files,
            links: vec![],
        })
    }

    async fn upload_image(&self, name: &str, data: &[u8]) -> anyhow::Result<String> {
        let clients = self.clients.read().await;
        let c = clients.values().next().ok_or_else(|| anyhow::anyhow!("无可用账号"))?;
        let uploaded = c.upload_media(data, name, 1, "").await?;
        Ok(serde_json::to_string(&uploaded.media)?)
    }

    async fn upload_file(&self, name: &str, data: &[u8]) -> anyhow::Result<String> {
        let clients = self.clients.read().await;
        let c = clients.values().next().ok_or_else(|| anyhow::anyhow!("无可用账号"))?;
        let uploaded = c.upload_media(data, name, 3, "").await?;
        Ok(serde_json::to_string(&uploaded.media)?)
    }

    async fn send_image_reply(&self, mid: &str, key: &str) -> anyhow::Result<()> {
        let (uid, _) = parse_mid(mid);
        let (c, ct) = self.resolve_client(&uid).await?;
        let media: super::client::CDNMedia = serde_json::from_str(key)?;
        c.send_image(&uid, &media, &ct).await
    }

    async fn send_file_reply(&self, mid: &str, key: &str) -> anyhow::Result<()> {
        let (uid, _) = parse_mid(mid);
        let (c, ct) = self.resolve_client(&uid).await?;
        let parts: Vec<&str> = key.splitn(3, '|').collect();
        let (mj, fn_, fs) = if parts.len() == 3 { (parts[0], parts[1], parts[2].parse().unwrap_or(0u64)) } else { (key, "file", 0u64) };
        let media: super::client::CDNMedia = serde_json::from_str(mj)?;
        c.send_file(&uid, &media, fn_, fs, &ct).await
    }

    async fn send_card(&self, cid: &str, _ct: &str, md: &str) -> anyhow::Result<String> {
        let (c, ct) = self.resolve_client(cid).await?;
        c.send_text(cid, md, &ct).await
    }

    fn mcp_tool_list(&self) -> Vec<serde_json::Value> {
        super::mcp_tools::list()
    }

    async fn mcp_tool_call(&self, tool_name: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
        // wechat_download_media 不需要特定用户上下文，用任意 client 即可
        if tool_name == "wechat_download_media" {
            let clients = self.clients.read().await;
            let client = clients.values().next().ok_or("无可用微信账号")?;
            return super::mcp_tools::call(tool_name, args, client, "").await;
        }

        // 其他 tools 需要从 args 提取 message_id 获取用户上下文
        let message_id = args.get("message_id").and_then(|v| v.as_str()).unwrap_or("");
        let (uid, _) = parse_mid(message_id);

        let (client, context_token) = self.resolve_client(&uid).await.map_err(|e| e.to_string())?;
        super::mcp_tools::call(tool_name, args, &client, &context_token).await
    }
}

// ── 辅助 ──────────────────────────────────────────────────────────────────

/// 处理一条消息：更新 context + recent cache + 转发给上层
async fn process_and_forward(
    msg: &ParsedWechatMessage,
    fwd_ctx: &Arc<RwLock<HashMap<String, UserContext>>>,
    fwd_recent: &Arc<RwLock<HashMap<String, RecentMessage>>>,
    fwd_id: &str,
    fwd_tx: &mpsc::Sender<ImMessage>,
) {
    let session_id = if msg.session_id.is_empty() {
        msg.from_user_id.clone()
    } else {
        msg.session_id.clone()
    };
    let message_id = format!("{}:{}", msg.from_user_id, msg.message_id);

    let cached = match &msg.content {
        WechatMessageContent::Text(t) => RecentMessage {
            text: Some(t.clone()),
            message_id: message_id.clone(),
            image_key: None,
            file_key: None,
            file_name: None,
        },
        WechatMessageContent::Image { media } => RecentMessage {
            text: None,
            message_id: message_id.clone(),
            image_key: Some(serde_json::to_string(media).unwrap_or_default()),
            file_key: None,
            file_name: None,
        },
        WechatMessageContent::File { media, file_name, .. } => RecentMessage {
            text: None,
            message_id: message_id.clone(),
            image_key: None,
            file_key: Some(serde_json::to_string(media).unwrap_or_default()),
            file_name: Some(file_name.clone()),
        },
        _ => RecentMessage {
            text: None,
            message_id: message_id.clone(),
            image_key: None,
            file_key: None,
            file_name: None,
        },
    };
    fwd_recent.write().await.insert(session_id, cached);

    fwd_ctx.write().await.insert(msg.from_user_id.clone(), UserContext {
        context_token: msg.context_token.clone(),
        account_id: fwd_id.to_string(),
    });

    let _ = fwd_tx.send(convert_message(msg.clone())).await;
}

fn convert_message(msg: ParsedWechatMessage) -> ImMessage {
    let is_text = matches!(&msg.content, WechatMessageContent::Text(_));
    // session_id 为空时 fallback 到 from_user_id
    let effective_session = if msg.session_id.is_empty() {
        msg.from_user_id.clone()
    } else {
        msg.session_id.clone()
    };
    ImMessage {
        message_id: format!("{}:{}", msg.from_user_id, msg.message_id),
        chat_id: effective_session.clone(),
        chat_type: "p2p".into(),
        sender_id: msg.from_user_id,
        content: convert_content(msg.content),
        timestamp: msg.timestamp_ms / 1000,
        topic_id: if is_text { Some(effective_session) } else { None },
    }
}

fn convert_content(c: WechatMessageContent) -> ImMessageContent {
    match c {
        WechatMessageContent::Text(t) => ImMessageContent::Text(t),
        WechatMessageContent::Image { media } => ImMessageContent::Image { image_key: serde_json::to_string(&media).unwrap_or_default() },
        WechatMessageContent::File { media, file_name, file_size } => ImMessageContent::File { file_key: serde_json::to_string(&media).unwrap_or_default(), file_name, file_size },
        WechatMessageContent::Voice { media, text } => {
            if let Some(t) = text.filter(|t| !t.is_empty()) { return ImMessageContent::Text(format!("[语音转文字] {t}")); }
            ImMessageContent::Audio { file_key: serde_json::to_string(&media).unwrap_or_default(), duration_ms: 0 }
        }
        WechatMessageContent::Video { media } => ImMessageContent::Media { file_key: serde_json::to_string(&media).unwrap_or_default(), file_name: "video.mp4".into(), duration_ms: 0, width: 0, height: 0 },
        WechatMessageContent::Unsupported { item_type } => ImMessageContent::Unsupported { message_type: format!("wechat_type_{item_type}"), raw_content: String::new() },
    }
}

fn parse_mid(mid: &str) -> (String, String) {
    mid.split_once(':').map(|(a, b)| (a.into(), b.into())).unwrap_or((mid.into(), String::new()))
}
