//! 微信 iLink Bot API 客户端
//!
//! 基于 ClawBot 的 iLink 协议实现，提供：
//! - QR 码登录 + Token 持久化
//! - Long-poll 消息轮询（getUpdates）
//! - 文本消息发送（sendMessage）
//! - CDN 媒体文件上传/下载（AES-128-ECB 加解密）
//!
//! ## 存储
//!
//! 所有账号信息统一存储在 `~/.acp-link/wechat/tokens.json`：
//! ```json
//! [
//!   { "token": "...", "base_url": "...", "account_id": "bot_xxx", "user_id": "...", "sync_buf": "...", "saved_at": "..." },
//!   { ... }
//! ]
//! ```
//!
//! 协议参考：<https://github.com/formulahendry/wechat-acp>

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

// ── 常量 ──────────────────────────────────────────────────────────────────

const CHANNEL_VERSION: &str = "2.0.0";
const DEFAULT_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const DEFAULT_CDN_URL: &str = "https://novac2c.cdn.weixin.qq.com/c2c";
const LONG_POLL_TIMEOUT_MS: u64 = 35_000;
const MAX_CONSECUTIVE_FAILURES: u32 = 3;
const BACKOFF_DELAY_MS: u64 = 30_000;
const RETRY_DELAY_MS: u64 = 2_000;
const SESSION_EXPIRED_ERRCODE: i64 = -14;

// ── 协议类型 ──────────────────────────────────────────────────────────────

#[allow(dead_code)]
pub mod msg_type {
    pub const NONE: u32 = 0;
    pub const USER: u32 = 1;
    pub const BOT: u32 = 2;
}

#[allow(dead_code)]
pub mod item_type {
    pub const NONE: u32 = 0;
    pub const TEXT: u32 = 1;
    pub const IMAGE: u32 = 2;
    pub const VOICE: u32 = 3;
    pub const FILE: u32 = 4;
    pub const VIDEO: u32 = 5;
}

#[allow(dead_code)]
pub mod msg_state {
    pub const NEW: u32 = 0;
    pub const GENERATING: u32 = 1;
    pub const FINISH: u32 = 2;
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct CDNMedia {
    pub encrypt_query_param: Option<String>,
    pub aes_key: Option<String>,
    pub encrypt_type: Option<u32>,
}

/// 上传结果
#[derive(Debug, Clone)]
pub struct UploadedMedia {
    pub media: CDNMedia,
    /// 明文大小
    #[allow(dead_code)]
    pub raw_size: u64,
    /// 密文大小
    pub ciphertext_size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct TextItem {
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ImageItem {
    pub media: Option<CDNMedia>,
    pub thumb_media: Option<CDNMedia>,
    pub aeskey: Option<String>,
    pub url: Option<String>,
    pub mid_size: Option<u64>,
    pub thumb_size: Option<u64>,
    pub thumb_height: Option<u32>,
    pub thumb_width: Option<u32>,
    pub hd_size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct FileItemProto {
    pub media: Option<CDNMedia>,
    pub file_name: Option<String>,
    pub md5: Option<String>,
    pub len: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct VoiceItem {
    pub media: Option<CDNMedia>,
    pub encode_type: Option<u32>,
    pub bits_per_sample: Option<u32>,
    pub sample_rate: Option<u32>,
    pub playtime: Option<u32>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct VideoItem {
    pub media: Option<CDNMedia>,
    pub video_size: Option<u64>,
    pub play_length: Option<u32>,
    pub video_md5: Option<String>,
    pub thumb_media: Option<CDNMedia>,
    pub thumb_size: Option<u64>,
    pub thumb_height: Option<u32>,
    pub thumb_width: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct MessageItem {
    #[serde(rename = "type")]
    pub item_type: Option<u32>,
    pub create_time_ms: Option<u64>,
    pub update_time_ms: Option<u64>,
    pub is_completed: Option<bool>,
    pub msg_id: Option<String>,
    pub text_item: Option<TextItem>,
    pub image_item: Option<ImageItem>,
    pub voice_item: Option<VoiceItem>,
    pub file_item: Option<FileItemProto>,
    pub video_item: Option<VideoItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct WeixinMessage {
    pub seq: Option<u64>,
    pub message_id: Option<u64>,
    pub from_user_id: Option<String>,
    pub to_user_id: Option<String>,
    pub client_id: Option<String>,
    pub create_time_ms: Option<u64>,
    pub update_time_ms: Option<u64>,
    pub delete_time_ms: Option<u64>,
    pub session_id: Option<String>,
    pub group_id: Option<String>,
    pub message_type: Option<u32>,
    pub message_state: Option<u32>,
    pub item_list: Option<Vec<MessageItem>>,
    pub context_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct GetUpdatesResp {
    pub ret: Option<i64>,
    pub errcode: Option<i64>,
    #[allow(dead_code)]
    pub errmsg: Option<String>,
    pub msgs: Option<Vec<WeixinMessage>>,
    pub get_updates_buf: Option<String>,
    #[allow(dead_code)]
    pub longpolling_timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct QrCodeResp {
    pub qrcode: String,
    pub qrcode_img_content: String,
}

#[derive(Debug, Deserialize)]
pub struct QrStatusResp {
    pub status: String,
    pub bot_token: Option<String>,
    pub baseurl: Option<String>,
    pub ilink_bot_id: Option<String>,
    pub ilink_user_id: Option<String>,
}

/// 持久化的账号数据（存储在 tokens.json 中的一个元素）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenData {
    pub token: String,
    pub base_url: String,
    pub account_id: String,
    pub user_id: String,
    /// 账号名称（配置中声明的，如 "Bingxin Liu"）
    #[serde(default)]
    pub name: String,
    /// 消息轮询断点
    #[serde(default)]
    pub sync_buf: String,
    pub saved_at: String,
}

// GetUploadUrlReq/Resp 不再需要，改用动态 JSON

// ── 解析后的消息类型 ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ParsedWechatMessage {
    pub message_id: String,
    pub from_user_id: String,
    pub session_id: String,
    pub context_token: String,
    pub content: WechatMessageContent,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone)]
pub enum WechatMessageContent {
    Text(String),
    Image { media: CDNMedia },
    File { media: CDNMedia, file_name: String, file_size: u64 },
    Voice { media: CDNMedia, text: Option<String> },
    Video { media: CDNMedia },
    Unsupported { item_type: u32 },
}

// ── TokenStore：统一管理 tokens.json ──────────────────────────────────────

/// 管理 `~/.acp-link/wechat/tokens.json` 文件
#[derive(Clone)]
pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new(storage_dir: &PathBuf) -> Self {
        Self {
            path: storage_dir.join("tokens.json"),
        }
    }

    /// 读取所有账号
    pub fn load_all(&self) -> Vec<TokenData> {
        if !self.path.exists() {
            return vec![];
        }
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default()
    }

    /// 保存所有账号
    pub fn save_all(&self, tokens: &[TokenData]) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(tokens)?;
        std::fs::write(&self.path, content)?;
        Ok(())
    }

    /// 添加或更新一个账号（按 name 去重，name 为空时按 account_id）
    pub fn upsert(&self, data: &TokenData) -> Result<()> {
        let mut all = self.load_all();
        let existing = if !data.name.is_empty() {
            all.iter_mut().find(|t| t.name == data.name)
        } else {
            all.iter_mut().find(|t| t.account_id == data.account_id)
        };
        if let Some(existing) = existing {
            *existing = data.clone();
        } else {
            all.push(data.clone());
        }
        self.save_all(&all)
    }

    /// 更新某个账号的 sync_buf
    pub fn update_sync_buf(&self, account_id: &str, sync_buf: &str) -> Result<()> {
        let mut all = self.load_all();
        if let Some(existing) = all.iter_mut().find(|t| t.account_id == account_id) {
            existing.sync_buf = sync_buf.to_string();
            self.save_all(&all)?;
        }
        Ok(())
    }
}

// ── WechatClient ──────────────────────────────────────────────────────────

/// 微信 iLink 客户端（单账号）
#[derive(Clone)]
pub struct WechatClient {
    http: Client,
    base_url: Arc<RwLock<String>>,
    cdn_base_url: String,
    token: Arc<RwLock<Option<String>>>,
    /// 该账号的 account_id
    pub account_id: Arc<RwLock<String>>,
    /// 账号名称
    pub name: Arc<RwLock<String>>,
    sync_buf: Arc<RwLock<String>>,
    store: TokenStore,
}

impl WechatClient {
    /// 从已有 TokenData 创建客户端（已登录状态）
    pub fn from_token(data: &TokenData, store: TokenStore) -> Self {
        Self {
            http: Client::new(),
            base_url: Arc::new(RwLock::new(data.base_url.clone())),
            cdn_base_url: DEFAULT_CDN_URL.to_string(),
            token: Arc::new(RwLock::new(Some(data.token.clone()))),
            account_id: Arc::new(RwLock::new(data.account_id.clone())),
            name: Arc::new(RwLock::new(data.name.clone())),
            sync_buf: Arc::new(RwLock::new(data.sync_buf.clone())),
            store,
        }
    }

    /// 创建未登录的客户端（用于扫码登录）
    pub fn new_unauthenticated(store: TokenStore) -> Self {
        Self {
            http: Client::new(),
            base_url: Arc::new(RwLock::new(DEFAULT_BASE_URL.to_string())),
            cdn_base_url: DEFAULT_CDN_URL.to_string(),
            token: Arc::new(RwLock::new(None)),
            account_id: Arc::new(RwLock::new(String::new())),
            name: Arc::new(RwLock::new(String::new())),
            sync_buf: Arc::new(RwLock::new(String::new())),
            store,
        }
    }

    fn build_headers(&self, token: Option<&str>) -> reqwest::header::HeaderMap {
        use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("application/json"),
        );
        headers.insert(
            HeaderName::from_static("authorizationtype"),
            HeaderValue::from_static("ilink_bot_token"),
        );
        let uin_bytes = uuid::Uuid::new_v4().as_bytes()[..4].to_vec();
        let uin_str = base64::engine::general_purpose::STANDARD.encode(&uin_bytes);
        if let Ok(v) = HeaderValue::from_str(&uin_str) {
            headers.insert(HeaderName::from_static("x-wechat-uin"), v);
        }
        if let Some(t) = token {
            if let Ok(v) = HeaderValue::from_str(&format!("Bearer {t}")) {
                headers.insert(reqwest::header::AUTHORIZATION, v);
            }
        }
        headers
    }

    /// QR 码登录，`name` 为该账号的标识名称
    pub async fn login(&self, name: &str) -> Result<TokenData> {
        let base_url = self.base_url.read().await.clone();
        tracing::info!("开始微信 QR 码登录 ({name})...");

        let url = format!("{}/ilink/bot/get_bot_qrcode?bot_type=3", base_url.trim_end_matches('/'));
        let resp = self.http
            .get(&url)
            .headers(self.build_headers(None))
            .send().await
            .context("请求 iLink QR 码失败（网络错误）")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("获取 QR 码失败: HTTP {status}: {body}");
        }

        let qr_resp: QrCodeResp = resp.json().await.context("解析 QR 码响应失败")?;

        println!("请使用微信扫描以下二维码登录（{name}）：");
        println!("{}", qr_resp.qrcode_img_content);

        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(300);
        let mut current_qrcode = qr_resp.qrcode;

        loop {
            if tokio::time::Instant::now() > deadline {
                anyhow::bail!("QR 码登录超时（5分钟）");
            }

            let status_url = format!(
                "{}/ilink/bot/get_qrcode_status?qrcode={}",
                base_url.trim_end_matches('/'),
                urlencoding::encode(&current_qrcode)
            );
            let status: QrStatusResp = self.http
                .get(&status_url)
                .headers(self.build_headers(None))
                .send().await?
                .json().await?;

            match status.status.as_str() {
                "wait" => {}
                "scaned" => {
                    tracing::info!("二维码已扫描，请在微信中确认...");
                }
                "expired" => {
                    tracing::warn!("二维码已过期，正在刷新...");
                    let new_resp: QrCodeResp = self.http
                        .get(&format!("{}/ilink/bot/get_bot_qrcode?bot_type=3", base_url.trim_end_matches('/')))
                        .headers(self.build_headers(None))
                        .send().await?
                        .json().await?;
                    current_qrcode = new_resp.qrcode;
                    println!("新的二维码：");
                    println!("{}", new_resp.qrcode_img_content);
                }
                "confirmed" => {
                    tracing::info!("微信登录成功！({name})");
                    let token_data = TokenData {
                        token: status.bot_token.unwrap_or_default(),
                        base_url: status.baseurl.unwrap_or_else(|| base_url.clone()),
                        account_id: status.ilink_bot_id.unwrap_or_default(),
                        user_id: status.ilink_user_id.unwrap_or_default(),
                        name: name.to_string(),
                        sync_buf: String::new(),
                        saved_at: chrono::Utc::now().to_rfc3339(),
                    };

                    // 持久化到 tokens.json
                    self.store.upsert(&token_data)?;

                    *self.token.write().await = Some(token_data.token.clone());
                    *self.base_url.write().await = token_data.base_url.clone();
                    *self.account_id.write().await = token_data.account_id.clone();
                    *self.name.write().await = name.to_string();

                    tracing::info!("Bot ID: {}", token_data.account_id);
                    return Ok(token_data);
                }
                other => {
                    tracing::warn!("未知 QR 状态: {other}");
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
        }
    }

    /// Long-poll 消息轮询
    pub async fn get_updates(&self) -> Result<GetUpdatesResp> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let sync_buf = self.sync_buf.read().await.clone();

        let url = format!("{}/ilink/bot/getupdates", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "get_updates_buf": sync_buf,
            "base_info": { "channel_version": CHANNEL_VERSION }
        });

        let resp = self.http
            .post(&url)
            .headers(self.build_headers(token.as_deref()))
            .json(&body)
            .timeout(std::time::Duration::from_millis(LONG_POLL_TIMEOUT_MS + 5_000))
            .send()
            .await;

        match resp {
            Ok(r) => {
                let text = r.text().await.unwrap_or_default();
                Ok(serde_json::from_str(&text).unwrap_or_default())
            }
            Err(e) if e.is_timeout() => Ok(GetUpdatesResp::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// 持续监听消息
    pub async fn listen(&self, tx: tokio::sync::mpsc::Sender<ParsedWechatMessage>) -> Result<()> {
        let mut consecutive_failures: u32 = 0;
        // 消息去重：记录最近处理过的 message_id
        let mut seen_ids: std::collections::VecDeque<u64> = std::collections::VecDeque::new();
        const MAX_SEEN: usize = 500;

        loop {
            match self.get_updates().await {
                Ok(resp) => {
                    let is_error = resp.ret.unwrap_or(0) != 0 || resp.errcode.unwrap_or(0) != 0;

                    if is_error {
                        let errcode = resp.errcode.unwrap_or(0);
                        if errcode == SESSION_EXPIRED_ERRCODE || resp.ret.unwrap_or(0) == SESSION_EXPIRED_ERRCODE {
                            tracing::warn!("微信 session 已过期，尝试重新登录...");
                            *self.token.write().await = None;
                            let name = self.name.read().await.clone();
                            if let Err(e) = self.login(&name).await {
                                tracing::error!("重新登录失败: {e}");
                                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                            }
                            continue;
                        }

                        consecutive_failures += 1;
                        tracing::warn!(
                            "getUpdates 失败: ret={:?} errcode={:?} ({}/{})",
                            resp.ret, resp.errcode, consecutive_failures, MAX_CONSECUTIVE_FAILURES
                        );
                        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                            consecutive_failures = 0;
                            tokio::time::sleep(tokio::time::Duration::from_millis(BACKOFF_DELAY_MS)).await;
                        } else {
                            tokio::time::sleep(tokio::time::Duration::from_millis(RETRY_DELAY_MS)).await;
                        }
                        continue;
                    }

                    consecutive_failures = 0;

                    // 更新 sync_buf
                    if let Some(ref buf) = resp.get_updates_buf {
                        if !buf.is_empty() {
                            *self.sync_buf.write().await = buf.clone();
                            let acct_id = self.account_id.read().await.clone();
                            let _ = self.store.update_sync_buf(&acct_id, buf);
                        }
                    }

                    // 解析消息
                    if let Some(msgs) = resp.msgs {
                        for msg in msgs {
                            if msg.message_type.unwrap_or(0) != msg_type::USER {
                                continue;
                            }
                            if msg.group_id.as_ref().is_some_and(|g| !g.is_empty()) {
                                continue;
                            }
                            // 去重
                            if let Some(mid) = msg.message_id {
                                if seen_ids.contains(&mid) {
                                    continue;
                                }
                                seen_ids.push_back(mid);
                                if seen_ids.len() > MAX_SEEN {
                                    seen_ids.pop_front();
                                }
                            }
                            if let Some(parsed) = Self::parse_message(&msg) {
                                if tx.send(parsed).await.is_err() {
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    consecutive_failures += 1;
                    tracing::error!("getUpdates 错误 ({}/{}): {e}", consecutive_failures, MAX_CONSECUTIVE_FAILURES);
                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                        consecutive_failures = 0;
                        tokio::time::sleep(tokio::time::Duration::from_millis(BACKOFF_DELAY_MS)).await;
                    } else {
                        tokio::time::sleep(tokio::time::Duration::from_millis(RETRY_DELAY_MS)).await;
                    }
                }
            }
        }
    }

    fn parse_message(msg: &WeixinMessage) -> Option<ParsedWechatMessage> {
        let from_user_id = msg.from_user_id.clone().unwrap_or_default();
        if from_user_id.is_empty() {
            return None;
        }
        let message_id = msg.message_id.map(|id| id.to_string()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let session_id = msg.session_id.clone().unwrap_or_else(|| from_user_id.clone());
        let context_token = msg.context_token.clone().unwrap_or_default();
        let timestamp_ms = msg.create_time_ms.unwrap_or(0);

        let items = msg.item_list.as_ref()?;
        let first = items.first()?;
        let itype = first.item_type.unwrap_or(0);

        let content = match itype {
            t if t == item_type::TEXT => {
                let text = first.text_item.as_ref().and_then(|ti| ti.text.clone()).unwrap_or_default();
                if text.is_empty() { return None; }
                WechatMessageContent::Text(text)
            }
            t if t == item_type::IMAGE => {
                let media = first.image_item.as_ref().and_then(|img| img.media.clone()).unwrap_or_default();
                WechatMessageContent::Image { media }
            }
            t if t == item_type::FILE => {
                let fi = first.file_item.as_ref()?;
                WechatMessageContent::File {
                    media: fi.media.clone().unwrap_or_default(),
                    file_name: fi.file_name.clone().unwrap_or_default(),
                    file_size: fi.len.as_ref().and_then(|s| s.parse().ok()).unwrap_or(0),
                }
            }
            t if t == item_type::VOICE => {
                let v = first.voice_item.as_ref()?;
                WechatMessageContent::Voice { media: v.media.clone().unwrap_or_default(), text: v.text.clone() }
            }
            t if t == item_type::VIDEO => {
                let v = first.video_item.as_ref()?;
                WechatMessageContent::Video { media: v.media.clone().unwrap_or_default() }
            }
            other => WechatMessageContent::Unsupported { item_type: other },
        };

        Some(ParsedWechatMessage { message_id, from_user_id, session_id, context_token, content, timestamp_ms })
    }

    /// 发送文本消息
    pub async fn send_text(&self, to_user_id: &str, text: &str, context_token: &str) -> Result<String> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let client_id = format!("acp-link-{}", uuid::Uuid::new_v4());

        let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "msg": {
                "from_user_id": "",
                "to_user_id": to_user_id,
                "client_id": &client_id,
                "message_type": msg_type::BOT,
                "message_state": msg_state::FINISH,
                "context_token": context_token,
                "item_list": [{ "type": item_type::TEXT, "text_item": { "text": text } }]
            }
        });

        let resp = self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body).send().await.context("发送消息失败")?;
        if !resp.status().is_success() {
            let s = resp.status();
            let t = resp.text().await.unwrap_or_default();
            anyhow::bail!("发送消息失败: HTTP {s}: {t}");
        }
        Ok(client_id)
    }

    /// 获取 typing_ticket（用于显示"正在输入"）
    pub async fn get_typing_ticket(&self, to_user_id: &str, context_token: &str) -> Result<Option<String>> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let url = format!("{}/ilink/bot/getconfig", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "ilink_user_id": to_user_id,
            "context_token": context_token
        });
        let resp = self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send().await?;
        let data: serde_json::Value = resp.json().await.unwrap_or_default();
        Ok(data.get("typing_ticket").and_then(|v| v.as_str()).map(|s| s.to_string()))
    }

    /// 发送/取消打字状态（status: 1=开始, 2=取消）
    pub async fn send_typing(&self, to_user_id: &str, typing_ticket: &str, status: u32) -> Result<()> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let url = format!("{}/ilink/bot/sendtyping", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "ilink_user_id": to_user_id,
            "typing_ticket": typing_ticket,
            "status": status
        });
        self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send().await?;
        Ok(())
    }

    /// 发送流式消息
    #[allow(dead_code)]
    pub async fn send_streaming(&self, to_user_id: &str, text: &str, context_token: &str, client_id: &str, is_finish: bool) -> Result<()> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let state = if is_finish { msg_state::FINISH } else { msg_state::GENERATING };

        let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "msg": {
                "from_user_id": "",
                "to_user_id": to_user_id,
                "client_id": client_id,
                "message_type": msg_type::BOT,
                "message_state": state,
                "context_token": context_token,
                "item_list": [{ "type": item_type::TEXT, "text_item": { "text": text } }]
            }
        });

        let resp = self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body).send().await.context("发送流式消息失败")?;
        let status = resp.status();
        let resp_body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            tracing::error!("sendmessage HTTP {status}: {resp_body}");
            anyhow::bail!("sendmessage 失败: HTTP {status}");
        }
        tracing::info!("sendmessage ok: state={state} client_id={client_id} resp={resp_body}");
        Ok(())
    }

    /// 下载 CDN 媒体
    pub async fn download_media(&self, media: &CDNMedia) -> Result<Vec<u8>> {
        let param = media.encrypt_query_param.as_ref().context("缺少 encrypt_query_param")?;
        let key = media.aes_key.as_ref().context("缺少 aes_key")?;
        let key_bytes = parse_aes_key(key)?;

        let url = format!("{}/download?encrypted_query_param={}", self.cdn_base_url.trim_end_matches('/'), urlencoding::encode(param));
        let resp = self.http.get(&url).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("CDN 下载失败: HTTP {}", resp.status());
        }
        let ciphertext = resp.bytes().await?;
        decrypt_aes_ecb(&ciphertext, &key_bytes)
    }

    /// 上传媒体到 CDN
    pub async fn upload_media(&self, data: &[u8], _file_name: &str, media_type: u32, to_user_id: &str) -> Result<UploadedMedia> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();

        let aes_key_bytes: [u8; 16] = rand_bytes();
        let aes_key_hex = hex::encode(aes_key_bytes); // hex for getUploadUrl
        // CDNMedia.aes_key = base64(hex_string)，跟 openclaw-weixin 一致
        let aes_key_for_media = base64::engine::general_purpose::STANDARD.encode(aes_key_hex.as_bytes());
        let file_md5 = format!("{:x}", md5::compute(data));
        let filekey = format!("acp-link-{}", uuid::Uuid::new_v4());
        let encrypted = encrypt_aes_ecb(data, &aes_key_bytes)?;

        // getUploadUrl: aeskey 用 hex 编码
        let req_body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "filekey": filekey,
            "media_type": media_type,
            "to_user_id": to_user_id,
            "rawsize": data.len(),
            "rawfilemd5": file_md5,
            "filesize": encrypted.len(),
            "no_need_thumb": true,
            "aeskey": aes_key_hex
        });

        let resp_text = self.http
            .post(&format!("{}/ilink/bot/getuploadurl", base_url.trim_end_matches('/')))
            .headers(self.build_headers(token.as_deref()))
            .json(&req_body).send().await?
            .text().await?;

        let resp: serde_json::Value = serde_json::from_str(&resp_text)
            .context(format!("getuploadurl 解析失败: {resp_text}"))?;

        // 优先用 upload_full_url，其次 upload_param
        let cdn_url = if let Some(full_url) = resp.get("upload_full_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            full_url.to_string()
        } else if let Some(upload_param) = resp.get("upload_param").and_then(|v| v.as_str()) {
            format!("{}/upload?encrypted_query_param={}&filekey={}",
                self.cdn_base_url.trim_end_matches('/'),
                urlencoding::encode(upload_param),
                urlencoding::encode(&filekey))
        } else {
            anyhow::bail!("getuploadurl 响应缺少 upload_full_url 和 upload_param: {resp_text}");
        };

        tracing::debug!("CDN upload URL: {cdn_url}, ciphertext size: {}", encrypted.len());

        let upload_resp = self.http
            .post(&cdn_url)
            .header("Content-Type", "application/octet-stream")
            .body(encrypted.clone())
            .send().await
            .context("CDN 上传请求失败")?;

        let status = upload_resp.status();
        let download_param = upload_resp.headers()
            .get("x-encrypted-param")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("").to_string();
        let resp_body = upload_resp.text().await.unwrap_or_default();

        if !status.is_success() {
            anyhow::bail!("CDN 上传失败: HTTP {status}, body={resp_body}");
        }

        if download_param.is_empty() {
            anyhow::bail!("CDN 上传成功但响应缺少 x-encrypted-param header, body={resp_body}");
        }

        Ok(UploadedMedia {
            media: CDNMedia {
                encrypt_query_param: Some(download_param),
                aes_key: Some(aes_key_for_media),
                encrypt_type: Some(1),
            },
            raw_size: data.len() as u64,
            ciphertext_size: encrypted.len() as u64,
        })
    }

    /// 发送图片消息
    pub async fn send_image(&self, to_user_id: &str, image_media: &CDNMedia, context_token: &str) -> Result<()> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let client_id = format!("acp-link-{}", uuid::Uuid::new_v4());
        let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "msg": {
                "from_user_id": "", "to_user_id": to_user_id, "client_id": client_id,
                "message_type": msg_type::BOT, "message_state": msg_state::FINISH, "context_token": context_token,
                "item_list": [{
                    "type": item_type::IMAGE,
                    "image_item": {
                        "media": {
                            "encrypt_query_param": image_media.encrypt_query_param,
                            "aes_key": image_media.aes_key,
                            "encrypt_type": image_media.encrypt_type.unwrap_or(1)
                        }
                    }
                }]
            }
        });
        let resp = self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body).send().await?;
        if !resp.status().is_success() {
            let s = resp.status();
            let t = resp.text().await.unwrap_or_default();
            anyhow::bail!("发送图片失败: HTTP {s}: {t}");
        }
        Ok(())
    }

    /// 发送图片消息（带密文大小，用于新上传的图片）
    pub async fn send_image_with_size(&self, to_user_id: &str, image_media: &CDNMedia, ciphertext_size: u64, context_token: &str) -> Result<()> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let client_id = format!("acp-link-{}", uuid::Uuid::new_v4());
        let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "msg": {
                "from_user_id": "", "to_user_id": to_user_id, "client_id": client_id,
                "message_type": msg_type::BOT, "message_state": msg_state::FINISH, "context_token": context_token,
                "item_list": [{
                    "type": item_type::IMAGE,
                    "image_item": {
                        "media": {
                            "encrypt_query_param": image_media.encrypt_query_param,
                            "aes_key": image_media.aes_key,
                            "encrypt_type": image_media.encrypt_type.unwrap_or(1)
                        },
                        "mid_size": ciphertext_size
                    }
                }]
            }
        });
        let resp = self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body).send().await?;
        if !resp.status().is_success() {
            let s = resp.status();
            let t = resp.text().await.unwrap_or_default();
            anyhow::bail!("发送图片失败: HTTP {s}: {t}");
        }
        Ok(())
    }

    /// 发送文件消息
    pub async fn send_file(&self, to_user_id: &str, file_media: &CDNMedia, file_name: &str, file_size: u64, context_token: &str) -> Result<()> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let client_id = format!("acp-link-{}", uuid::Uuid::new_v4());
        let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "msg": {
                "from_user_id": "", "to_user_id": to_user_id, "client_id": client_id,
                "message_type": msg_type::BOT, "message_state": msg_state::FINISH, "context_token": context_token,
                "item_list": [{
                    "type": item_type::FILE,
                    "file_item": {
                        "media": {
                            "encrypt_query_param": file_media.encrypt_query_param,
                            "aes_key": file_media.aes_key,
                            "encrypt_type": file_media.encrypt_type.unwrap_or(1)
                        },
                        "file_name": file_name,
                        "len": file_size.to_string()
                    }
                }]
            }
        });
        let resp = self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body).send().await?;
        if !resp.status().is_success() {
            let s = resp.status();
            let t = resp.text().await.unwrap_or_default();
            anyhow::bail!("发送文件失败: HTTP {s}: {t}");
        }
        Ok(())
    }

    /// 发送视频消息
    pub async fn send_video(&self, to_user_id: &str, video_media: &CDNMedia, ciphertext_size: u64, context_token: &str) -> Result<()> {
        let base_url = self.base_url.read().await.clone();
        let token = self.token.read().await.clone();
        let client_id = format!("acp-link-{}", uuid::Uuid::new_v4());
        let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "base_info": { "channel_version": CHANNEL_VERSION },
            "msg": {
                "from_user_id": "", "to_user_id": to_user_id, "client_id": client_id,
                "message_type": msg_type::BOT, "message_state": msg_state::FINISH, "context_token": context_token,
                "item_list": [{
                    "type": item_type::VIDEO,
                    "video_item": {
                        "media": {
                            "encrypt_query_param": video_media.encrypt_query_param,
                            "aes_key": video_media.aes_key,
                            "encrypt_type": video_media.encrypt_type.unwrap_or(1)
                        },
                        "video_size": ciphertext_size
                    }
                }]
            }
        });
        let resp = self.http.post(&url).headers(self.build_headers(token.as_deref())).json(&body).send().await?;
        if !resp.status().is_success() {
            let s = resp.status();
            let t = resp.text().await.unwrap_or_default();
            anyhow::bail!("发送视频失败: HTTP {s}: {t}");
        }
        Ok(())
    }
}

// ── AES-128-ECB ──────────────────────────────────────────────────────────

fn parse_aes_key(key_b64: &str) -> Result<[u8; 16]> {
    let decoded = base64::engine::general_purpose::STANDARD.decode(key_b64).context("AES key base64 解码失败")?;
    if decoded.len() == 16 {
        let mut arr = [0u8; 16];
        arr.copy_from_slice(&decoded);
        return Ok(arr);
    }
    if decoded.len() == 32 {
        let hex_str = String::from_utf8(decoded.clone()).unwrap_or_default();
        if hex_str.chars().all(|c| c.is_ascii_hexdigit()) {
            let bytes = hex::decode(&hex_str).context("hex 解码失败")?;
            if bytes.len() == 16 {
                let mut arr = [0u8; 16];
                arr.copy_from_slice(&bytes);
                return Ok(arr);
            }
        }
    }
    if decoded.len() >= 16 {
        let mut arr = [0u8; 16];
        arr.copy_from_slice(&decoded[..16]);
        return Ok(arr);
    }
    anyhow::bail!("无效的 AES key 长度: {}", decoded.len())
}

fn decrypt_aes_ecb(ciphertext: &[u8], key: &[u8; 16]) -> Result<Vec<u8>> {
    use aes::cipher::{BlockDecrypt, KeyInit, generic_array::GenericArray};
    if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        anyhow::bail!("密文长度无效: {}", ciphertext.len());
    }
    let cipher = aes::Aes128::new(GenericArray::from_slice(key));
    let mut buf = ciphertext.to_vec();
    for chunk in buf.chunks_exact_mut(16) {
        cipher.decrypt_block(GenericArray::from_mut_slice(chunk));
    }
    // PKCS7 unpad
    let pad = *buf.last().unwrap_or(&0) as usize;
    if pad == 0 || pad > 16 || buf.len() < pad {
        anyhow::bail!("PKCS7 填充无效");
    }
    buf.truncate(buf.len() - pad);
    Ok(buf)
}

fn encrypt_aes_ecb(plaintext: &[u8], key: &[u8; 16]) -> Result<Vec<u8>> {
    use aes::cipher::{BlockEncrypt, KeyInit, generic_array::GenericArray};
    let pad = 16 - (plaintext.len() % 16);
    let mut buf = plaintext.to_vec();
    buf.extend(std::iter::repeat(pad as u8).take(pad));
    let cipher = aes::Aes128::new(GenericArray::from_slice(key));
    for chunk in buf.chunks_exact_mut(16) {
        cipher.encrypt_block(GenericArray::from_mut_slice(chunk));
    }
    Ok(buf)
}

fn rand_bytes() -> [u8; 16] {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    bytes
}
