//! 多平台聚合 Channel
//!
//! 将多个 `IMChannel` 聚合为一个，所有平台的消息汇入同一个管道，
//! 回复时根据 message_id 前缀自动路由到正确的 channel。
//!
//! message_id 格式：`{platform}#{original_message_id}`

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::im::{AbortEvent, IMChannel, ImMessage, TopicSubmission};

/// 多平台聚合 Channel
pub struct MultiChannel {
    channels: Vec<Arc<dyn IMChannel>>,
}

impl MultiChannel {
    pub fn new(channels: Vec<Arc<dyn IMChannel>>) -> Self {
        Self { channels }
    }

    /// 根据 message_id 前缀找到对应的 channel
    fn route(&self, message_id: &str) -> Option<(Arc<dyn IMChannel>, String)> {
        if let Some((platform, rest)) = message_id.split_once('#') {
            for ch in &self.channels {
                if ch.platform_name() == platform {
                    return Some((ch.clone(), rest.to_string()));
                }
            }
        }
        // 无前缀时用第一个 channel（兼容旧格式）
        self.channels.first().map(|ch| (ch.clone(), message_id.to_string()))
    }

    /// 根据 chat_id 前缀路由
    fn route_by_chat(&self, chat_id: &str) -> Option<(Arc<dyn IMChannel>, String)> {
        if let Some((platform, rest)) = chat_id.split_once('#') {
            for ch in &self.channels {
                if ch.platform_name() == platform {
                    return Some((ch.clone(), rest.to_string()));
                }
            }
        }
        self.channels.first().map(|ch| (ch.clone(), chat_id.to_string()))
    }
}

#[async_trait]
impl IMChannel for MultiChannel {
    fn platform_name(&self) -> &str {
        "multi"
    }

    async fn listen(&self, tx: mpsc::Sender<ImMessage>) -> anyhow::Result<()> {
        let mut handles = Vec::new();

        for ch in &self.channels {
            let ch = ch.clone();
            let tx = tx.clone();
            let platform = ch.platform_name().to_string();

            let handle = tokio::spawn(async move {
                // 为每个 channel 创建一个转发层，给 message_id/chat_id 加平台前缀
                let (inner_tx, mut inner_rx) = mpsc::channel::<ImMessage>(256);
                let fwd_tx = tx.clone();
                let pfx = platform.clone();
                let forward = tokio::spawn(async move {
                    while let Some(mut msg) = inner_rx.recv().await {
                        msg.message_id = format!("{}#{}", pfx, msg.message_id);
                        msg.chat_id = format!("{}#{}", pfx, msg.chat_id);
                        if let Some(ref tid) = msg.topic_id {
                            msg.topic_id = Some(format!("{}#{}", pfx, tid));
                        }
                        if fwd_tx.send(msg).await.is_err() {
                            break;
                        }
                    }
                });

                let result = ch.listen(inner_tx).await;
                forward.abort();
                if let Err(ref e) = result {
                    tracing::error!("[{platform}] listen 退出: {e}");
                }
                result
            });

            handles.push(handle);
        }

        // 等待任意 channel 退出
        let (result, _, rest) = futures::future::select_all(handles).await;
        for h in rest {
            h.abort();
        }

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e),
            Err(e) => Err(anyhow::anyhow!("channel task panic: {e}")),
        }
    }

    async fn reply_message(&self, message_id: &str, markdown: &str) -> anyhow::Result<(String, String)> {
        let (ch, raw_id) = self.route(message_id).ok_or_else(|| anyhow::anyhow!("无法路由 message_id: {message_id}"))?;
        let platform = ch.platform_name();
        let (new_id, thread_id) = ch.reply_message(&raw_id, markdown).await?;
        Ok((format!("{platform}#{new_id}"), format!("{platform}#{thread_id}")))
    }

    async fn update_message(&self, message_id: &str, markdown: &str) -> anyhow::Result<()> {
        let (ch, raw_id) = self.route(message_id).ok_or_else(|| anyhow::anyhow!("无法路由 message_id: {message_id}"))?;
        ch.update_message(&raw_id, markdown).await
    }

    async fn download_resource(&self, message_id: &str, file_key: &str, resource_type: &str) -> anyhow::Result<Vec<u8>> {
        let (ch, raw_id) = self.route(message_id).ok_or_else(|| anyhow::anyhow!("无法路由"))?;
        ch.download_resource(&raw_id, file_key, resource_type).await
    }

    async fn aggregate_topic(&self, topic_id: &str, chat_id: &str) -> anyhow::Result<TopicSubmission> {
        let (ch, raw_topic) = self.route(topic_id).ok_or_else(|| anyhow::anyhow!("无法路由 topic"))?;
        let raw_chat = chat_id.split_once('#').map(|(_, r)| r).unwrap_or(chat_id);
        let mut sub = ch.aggregate_topic(&raw_topic, raw_chat).await?;
        let platform = ch.platform_name();
        sub.topic_id = format!("{platform}#{}", sub.topic_id);
        sub.chat_id = format!("{platform}#{}", sub.chat_id);
        Ok(sub)
    }

    async fn upload_image(&self, file_name: &str, image_data: &[u8]) -> anyhow::Result<String> {
        // 默认用第一个 channel
        self.channels.first().ok_or_else(|| anyhow::anyhow!("无可用 channel"))?.upload_image(file_name, image_data).await
    }

    async fn upload_file(&self, file_name: &str, file_data: &[u8]) -> anyhow::Result<String> {
        self.channels.first().ok_or_else(|| anyhow::anyhow!("无可用 channel"))?.upload_file(file_name, file_data).await
    }

    async fn send_image_reply(&self, message_id: &str, image_key: &str) -> anyhow::Result<()> {
        let (ch, raw_id) = self.route(message_id).ok_or_else(|| anyhow::anyhow!("无法路由"))?;
        ch.send_image_reply(&raw_id, image_key).await
    }

    async fn send_file_reply(&self, message_id: &str, file_key: &str) -> anyhow::Result<()> {
        let (ch, raw_id) = self.route(message_id).ok_or_else(|| anyhow::anyhow!("无法路由"))?;
        ch.send_file_reply(&raw_id, file_key).await
    }

    async fn send_card(&self, chat_id: &str, chat_type: &str, markdown: &str) -> anyhow::Result<String> {
        let (ch, raw_chat) = self.route_by_chat(chat_id).ok_or_else(|| anyhow::anyhow!("无法路由 chat"))?;
        let platform = ch.platform_name();
        let id = ch.send_card(&raw_chat, chat_type, markdown).await?;
        Ok(format!("{platform}#{id}"))
    }

    fn mcp_tool_list(&self) -> Vec<serde_json::Value> {
        self.channels.iter().flat_map(|ch| ch.mcp_tool_list()).collect()
    }

    async fn mcp_tool_call(&self, tool_name: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
        for ch in &self.channels {
            let tools = ch.mcp_tool_list();
            if tools.iter().any(|t| t.get("name").and_then(|n| n.as_str()) == Some(tool_name)) {
                // strip 平台前缀 from message_id in args
                let mut args = args.clone();
                if let Some(mid) = args.get("message_id").and_then(|v| v.as_str()) {
                    if let Some((_platform, raw)) = mid.split_once('#') {
                        args["message_id"] = serde_json::Value::String(raw.to_string());
                    }
                }
                return ch.mcp_tool_call(tool_name, &args).await;
            }
        }
        Err(format!("未找到 tool: {tool_name}"))
    }

    fn subscribe_abort(&self) -> Option<mpsc::UnboundedReceiver<AbortEvent>> {
        // 合并所有 channel 的 abort 事件，加平台前缀
        let mut receivers = Vec::new();
        let mut platforms = Vec::new();
        for ch in &self.channels {
            if let Some(rx) = ch.subscribe_abort() {
                platforms.push(ch.platform_name().to_string());
                receivers.push(rx);
            }
        }
        if receivers.is_empty() {
            return None;
        }

        let (tx, out_rx) = mpsc::unbounded_channel();
        for (mut rx, platform) in receivers.into_iter().zip(platforms) {
            let tx = tx.clone();
            tokio::spawn(async move {
                while let Some(mut evt) = rx.recv().await {
                    evt.message_id = format!("{platform}#{}", evt.message_id);
                    let _ = tx.send(evt);
                }
            });
        }
        Some(out_rx)
    }
}
