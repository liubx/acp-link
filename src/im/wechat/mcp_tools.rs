//! 微信相关的 MCP Tool 定义与实现
//!
//! 提供 MCP tool 供 agent 反向调用：
//!
//! - `wechat_send_file` — 上传并发送文件/图片到微信用户

use serde_json::{Value, json};

use super::client::WechatClient;/// 返回微信相关 tools 的 schema 列表
pub fn list() -> Vec<Value> {
    vec![
        json!({
            "name": "wechat_send_file",
            "description": "Upload and send a file or image to the WeChat user. ONLY use this tool when the message_id in [im_context] starts with 'wechat#' or contains '@im.wechat'. For image files (.png/.jpg/.gif/.webp/.bmp), sent as image message; otherwise as file attachment. Extract message_id from [im_context] in the conversation. Do NOT use feishu_send_file for WeChat messages.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Absolute path to the file to upload"
                    },
                    "message_id": {
                        "type": "string",
                        "description": "The message_id from [im_context] (format: user_id:msg_id)"
                    },
                    "file_name": {
                        "type": "string",
                        "description": "Optional display name for the file"
                    }
                },
                "required": ["file_path", "message_id"]
            }
        }),
    ]
}

/// 分发微信 tool 调用
pub async fn call(
    tool_name: &str,
    args: &Value,
    client: &WechatClient,
    context_token: &str,
) -> Result<Value, String> {
    match tool_name {
        "wechat_send_file" => send_file(args, client, context_token).await,
        _ => Err(format!("unknown tool: {tool_name}")),
    }
}

/// 上传并发送文件/图片到微信
async fn send_file(
    args: &Value,
    client: &WechatClient,
    context_token: &str,
) -> Result<Value, String> {
    let file_path = args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
    let message_id = args.get("message_id").and_then(|v| v.as_str()).unwrap_or("");
    let file_name = args
        .get("file_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| basename(file_path).to_string());

    if file_path.is_empty() || message_id.is_empty() {
        return Err("file_path and message_id are required".into());
    }

    // 从 message_id 解析出 user_id
    let user_id = message_id.split_once(':').map(|(u, _)| u).unwrap_or(message_id);

    let data = std::fs::read(file_path).map_err(|e| format!("读取文件失败: {e}"))?;

    if is_image_file(file_path) {
        // 图片：上传到 CDN 后发送图片消息
        let media_type = 1; // IMAGE
        let uploaded = client
            .upload_media(&data, &file_name, media_type, user_id)
            .await
            .map_err(|e| format!("上传图片失败: {e}"))?;

        client
            .send_image_with_size(user_id, &uploaded.media, uploaded.ciphertext_size, context_token)
            .await
            .map_err(|e| format!("发送图片失败: {e}"))?;

        tracing::info!("wechat_send_file: 图片已发送 to={user_id} file={file_name}");
        Ok(json!({ "status": "ok", "type": "image", "file_name": file_name }))
    } else if is_video_file(file_path) {
        // 视频
        let media_type = 2; // VIDEO
        let uploaded = client
            .upload_media(&data, &file_name, media_type, user_id)
            .await
            .map_err(|e| format!("上传视频失败: {e}"))?;

        client
            .send_video(user_id, &uploaded.media, uploaded.ciphertext_size, context_token)
            .await
            .map_err(|e| format!("发送视频失败: {e}"))?;

        tracing::info!("wechat_send_file: 视频已发送 to={user_id} file={file_name}");
        Ok(json!({ "status": "ok", "type": "video", "file_name": file_name }))
    } else {
        // 文件附件
        let media_type = 3; // FILE
        let file_size = data.len() as u64;
        let uploaded = client
            .upload_media(&data, &file_name, media_type, user_id)
            .await
            .map_err(|e| format!("上传文件失败: {e}"))?;

        client
            .send_file(user_id, &uploaded.media, &file_name, file_size, context_token)
            .await
            .map_err(|e| format!("发送文件失败: {e}"))?;

        tracing::info!("wechat_send_file: 文件已发送 to={user_id} file={file_name}");
        Ok(json!({ "status": "ok", "type": "file", "file_name": file_name }))
    }
}

fn is_image_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
}

fn is_video_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".mp4")
        || lower.ends_with(".mov")
        || lower.ends_with(".avi")
        || lower.ends_with(".mkv")
        || lower.ends_with(".webm")
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}
