//! HTTP API — `/api/ask` SSE 流式问答端点
//!
//! 提供 HTTP 接口直接与 agent 对话，返回 SSE 流。
//! 复用 AcpBridge 进程池和 session 管理。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use tokio::sync::RwLock;

use crate::link::{AcpBridge, StreamEvent};

/// API Server 共享状态
struct ApiState {
    bridge: AcpBridge,
    cwd: PathBuf,
    /// chat_id → acp_session_id
    sessions: RwLock<HashMap<String, String>>,
}

/// 启动 API HTTP Server（与 MCP Server 共用端口，由调用方合并路由）
pub fn api_routes(bridge: AcpBridge, cwd: PathBuf) -> Router {
    let state = Arc::new(ApiState {
        bridge,
        cwd,
        sessions: RwLock::new(HashMap::new()),
    });

    Router::new()
        .route("/api/ask", post(handle_ask))
        .with_state(state)
}

#[derive(serde::Deserialize)]
struct AskBody {
    question: Option<String>,
    session: Option<String>,
}

/// POST /api/ask — SSE 流式问答
async fn handle_ask(
    State(state): State<Arc<ApiState>>,
    body: String,
) -> Response {
    let parsed: AskBody = serde_json::from_str(&body).unwrap_or(AskBody {
        question: Some(body.clone()),
        session: None,
    });
    let question = parsed.question.unwrap_or(body);
    let chat_id = parsed.session.unwrap_or_else(|| "default".to_string());

    if question.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "question is required").into_response();
    }

    // 获取或创建 session
    let session_id = {
        let sessions = state.sessions.read().await;
        sessions.get(&chat_id).cloned()
    };

    let session_id = match session_id {
        Some(sid) => {
            let _ = state.bridge.load_session(&chat_id, &sid, state.cwd.clone()).await;
            sid
        }
        None => {
            match state.bridge.new_session(&chat_id, state.cwd.clone()).await {
                Ok(sid) => {
                    state.sessions.write().await.insert(chat_id.clone(), sid.clone());
                    sid
                }
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to create session: {e}"),
                    ).into_response();
                }
            }
        }
    };

    // 构建 prompt
    let blocks = vec![AcpBridge::text_block(&question)];

    // 发送 prompt 并获取流
    let rx = match state.bridge.prompt_stream(&chat_id, &session_id, blocks).await {
        Ok(rx) => rx,
        Err(e) => {
            state.sessions.write().await.remove(&chat_id);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Prompt failed: {e}"),
            ).into_response();
        }
    };

    // SSE stream
    let stream = async_stream::stream! {
        let mut rx = rx;
        while let Some(event) = rx.recv().await {
            let data = match event {
                StreamEvent::Text(t) => serde_json::json!({"type": "text", "content": t}),
                StreamEvent::ToolCall(t) => serde_json::json!({"type": "tool", "content": t}),
            };
            yield Ok::<_, std::convert::Infallible>(format!("data: {}\n\n", data));
        }
        yield Ok(format!("data: {}\n\n", serde_json::json!({"type": "done"})));
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .header("access-control-allow-origin", "*")
        .body(Body::from_stream(stream))
        .unwrap()
}
