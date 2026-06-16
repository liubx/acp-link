//! MCP Server (Streamable HTTP)
//!
//! 以 HTTP 服务形式运行，对外暴露 `/mcp` endpoint，
//! 实现 MCP Streamable HTTP transport 规范（JSON-RPC 2.0）。
//!
//! ## 支持的 method
//!
//! - `initialize` — 创建 session，返回 server capabilities 和 session ID
//! - `tools/list` — 列出可用工具（由 `IMChannel::mcp_tool_list()` 动态提供）
//! - `tools/call` — 执行工具调用（由 `IMChannel::mcp_tool_call()` 分发）
//!
//! ## Session 管理
//!
//! - `POST /mcp` 的 `initialize` 请求生成 UUID v4 作为 session ID
//! - 后续请求需在 `Mcp-Session-Id` header 中携带
//! - `DELETE /mcp` 终止 session
//! - 当前为简单实现，仅支持单 session
//!
//! ## 架构
//!
//! MCP Server 通过 `Arc<dyn IMChannel>` 调用 IM 平台能力，
//! 与具体 IM 平台解耦。不同平台可注册不同的工具集。

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde_json::{Value, json};
use tokio::sync::RwLock;

use crate::im::IMChannel;

/// MCP Server 共享状态
struct McpState {
    channel: Arc<dyn IMChannel>,
    /// 活跃 session ID（简单实现：仅支持单 session）
    session_id: RwLock<Option<String>>,
}

/// 启动 MCP HTTP Server（作为后台 task 运行）
pub async fn start_mcp_server(
    channel: Arc<dyn IMChannel>,
    port: u16,
    extra_routes: Option<Router>,
) -> Result<()> {
    let state = Arc::new(McpState {
        channel,
        session_id: RwLock::new(None),
    });

    let mut app = Router::new()
        .route("/mcp", post(handle_post))
        .route("/mcp", get(handle_get))
        .route("/mcp", delete(handle_delete))
        .with_state(state)
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024)); // 50MB

    // 合并额外路由（如 /api/ask）
    if let Some(extra) = extra_routes {
        app = app.merge(extra);
    }

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("HTTP Server 监听: http://0.0.0.0:{port}");

    axum::serve(listener, app)
        .await
        .map_err(|e| anyhow::anyhow!("HTTP server 退出: {e}"))
}

/// POST /mcp — 接收 JSON-RPC 请求
async fn handle_post(
    State(state): State<Arc<McpState>>,
    _headers: HeaderMap,
    body: String,
) -> Response {
    let req: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                None,
                make_error(&Value::Null, -32700, &format!("Parse error: {e}")),
            );
        }
    };

    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    // notification（无 id）→ 202 Accepted
    if req.get("id").is_none() {
        return (StatusCode::ACCEPTED, "").into_response();
    }

    // 非 initialize 请求需要验证 session（容错：不匹配时自动接受，避免重启后 agent 连接失败）
    if method != "initialize" {
        let expected = state.session_id.read().await;
        if expected.is_none() {
            // 尚未 initialize，自动创建 session
            drop(expected);
            let sid = uuid::Uuid::new_v4().to_string();
            *state.session_id.write().await = Some(sid);
        }
    }

    let resp = match method {
        "initialize" => {
            let sid = uuid::Uuid::new_v4().to_string();
            *state.session_id.write().await = Some(sid);
            handle_initialize(&id, &state)
        }
        "tools/list" => handle_tools_list(&id, &state),
        "tools/call" => handle_tools_call(&id, &params, &state).await,
        _ => make_error(&id, -32601, &format!("Method not found: {method}")),
    };

    let current_sid = state.session_id.read().await.clone();
    json_response(StatusCode::OK, current_sid.as_deref(), resp)
}

/// GET /mcp — SSE stream（当前不需要 server-initiated 消息，返回 405）
async fn handle_get() -> Response {
    (StatusCode::METHOD_NOT_ALLOWED, "SSE not supported").into_response()
}

/// DELETE /mcp — 终止 session
async fn handle_delete(State(state): State<Arc<McpState>>, headers: HeaderMap) -> Response {
    let expected = state.session_id.read().await.clone();
    let client_sid = headers.get("mcp-session-id").and_then(|v| v.to_str().ok());

    if expected.as_deref() == client_sid {
        *state.session_id.write().await = None;
        (StatusCode::OK, "").into_response()
    } else {
        (StatusCode::NOT_FOUND, "").into_response()
    }
}

// ── JSON-RPC handlers ──────────────────────────────────────────

fn handle_initialize(id: &Value, state: &McpState) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": format!("{}-mcp", state.channel.platform_name()),
                "version": "0.1.0"
            }
        }
    })
}

fn handle_tools_list(id: &Value, state: &McpState) -> Value {
    let mut tools = state.channel.mcp_tool_list();
    // 添加 web_send_file 工具（Web chat 场景下 agent 用它发送文件/图片）
    tools.push(json!({
        "name": "web_send_file",
        "description": "Send a file or image to the current web chat session. Use this when the send_file_tool in [im_context] is 'web_send_file'. The file will be served via HTTP and shown inline (images) or as a download link in the web chat. Extract the session from the request context.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute path to the file to send"
                },
                "session": {
                    "type": "string",
                    "description": "The web chat session ID (from im_context chat_id)"
                },
                "file_name": {
                    "type": "string",
                    "description": "Optional display name. Defaults to basename of file_path"
                }
            },
            "required": ["file_path", "session"]
        }
    }));
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "tools": tools
        }
    })
}

async fn handle_tools_call(id: &Value, params: &Value, state: &McpState) -> Value {
    let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    // web_send_file 由 MCP server 直接处理（不走 IMChannel）
    if tool_name == "web_send_file" {
        return match handle_web_send_file(&args).await {
            Ok(data) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{ "type": "text", "text": data.to_string() }]
                }
            }),
            Err(msg) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{ "type": "text", "text": msg }],
                    "isError": true
                }
            }),
        };
    }

    match state.channel.mcp_tool_call(tool_name, &args).await {
        Ok(data) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": data.to_string() }]
            }
        }),
        Err(msg) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": msg }],
                "isError": true
            }
        }),
    }
}

/// 处理 web_send_file MCP tool：复制文件到 .tmp/download/ 并通过 broadcast 通知 SSE 流
async fn handle_web_send_file(args: &Value) -> Result<Value, String> {
    let file_path = args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
    let session = args.get("session").and_then(|v| v.as_str()).unwrap_or("");
    let file_name = args
        .get("file_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            std::path::Path::new(file_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string()
        });

    if file_path.is_empty() || session.is_empty() {
        return Err("file_path and session are required".into());
    }

    // 读取源文件
    let data = std::fs::read(file_path).map_err(|e| format!("读取文件失败: {e}"))?;

    // 保存到 cwd/.tmp/download/（使用时间戳避免冲突）
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let upload_dir = cwd.join(".tmp/download");
    let _ = std::fs::create_dir_all(&upload_dir);

    let safe_name = file_name.replace('/', "_").replace('\\', "_");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let final_name = format!("{ts}-{safe_name}");
    let dest = upload_dir.join(&final_name);

    std::fs::write(&dest, &data).map_err(|e| format!("写入文件失败: {e}"))?;

    // 判断是否为图片
    let lower = safe_name.to_lowercase();
    let is_image = lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp");

    // 构建 URL（相对路径，前端通过静态文件服务访问）
    let url = format!("/.tmp/download/{}", urlencoding::encode(&final_name));

    // 通过 broadcast 通知活跃的 SSE 流
    let event = crate::api::WebFileEvent {
        session: session.to_string(),
        name: safe_name.clone(),
        url: url.clone(),
        is_image,
    };
    let _ = crate::api::web_file_sender().send(event);

    tracing::info!("web_send_file: session={session}, name={safe_name}, url={url}, is_image={is_image}");
    Ok(json!({ "status": "sent", "name": safe_name, "url": url, "is_image": is_image }))
}

// ── helpers ─────────────────────────────────────────────────────

fn json_response(status: StatusCode, session_id: Option<&str>, body: Value) -> Response {
    let mut builder = Response::builder()
        .status(status)
        .header("content-type", "application/json");
    if let Some(sid) = session_id {
        builder = builder.header("mcp-session-id", sid);
    }
    builder
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "").into_response())
}

fn make_error(id: &Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── make_error ──────────────────────────────────────────────────────────

    #[test]
    fn test_make_error_structure() {
        let err = make_error(&json!(1), -32600, "Invalid Request");
        assert_eq!(err["jsonrpc"], "2.0");
        assert_eq!(err["id"], 1);
        assert_eq!(err["error"]["code"], -32600);
        assert_eq!(err["error"]["message"], "Invalid Request");
    }

    #[test]
    fn test_make_error_null_id() {
        let err = make_error(&Value::Null, -32700, "Parse error");
        assert!(err["id"].is_null());
    }

    // ── test helper ────────────────────────────────────────────────────────

    fn test_state() -> McpState {
        use crate::im::FeishuChannel;
        let channel = FeishuChannel::new("test_id", "test_secret");
        McpState {
            channel: Arc::new(channel),
            session_id: RwLock::new(None),
        }
    }

    // ── handle_initialize ───────────────────────────────────────────────────

    #[test]
    fn test_handle_initialize_response() {
        let state = test_state();
        let resp = handle_initialize(&json!(1), &state);
        assert_eq!(resp["jsonrpc"], "2.0");
        assert_eq!(resp["id"], 1);
        let result = &resp["result"];
        assert_eq!(result["serverInfo"]["name"], "feishu-mcp");
        assert!(result["capabilities"]["tools"].is_object());
    }

    // ── handle_tools_list ───────────────────────────────────────────────────

    #[test]
    fn test_handle_tools_list_response() {
        let state = test_state();
        let resp = handle_tools_list(&json!(2), &state);
        assert_eq!(resp["id"], 2);
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert!(!tools.is_empty());
        assert_eq!(tools[0]["name"], "feishu_send_file");
    }

    // ── json_response ───────────────────────────────────────────────────────

    #[test]
    fn test_json_response_with_session_id() {
        let resp = json_response(StatusCode::OK, Some("sid-123"), json!({"ok": true}));
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get("mcp-session-id")
                .unwrap()
                .to_str()
                .unwrap(),
            "sid-123"
        );
    }

    #[test]
    fn test_json_response_without_session_id() {
        let resp = json_response(StatusCode::BAD_REQUEST, None, json!({"error": "bad"}));
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert!(resp.headers().get("mcp-session-id").is_none());
    }

    // ── handle_get / handle_delete ──────────────────────────────────────────

    #[tokio::test]
    async fn test_handle_get_returns_method_not_allowed() {
        let resp = handle_get().await;
        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
    }
}
