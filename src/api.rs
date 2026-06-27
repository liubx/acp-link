//! HTTP API — `/api/ask` SSE 流式问答端点
//!
//! 提供 HTTP 接口直接与 agent 对话，返回 SSE 流。
//! 复用 AcpBridge 进程池和 session 管理。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State, Path, Query};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response, Json};
use axum::routing::{post, get};
use tokio::sync::{RwLock, broadcast};

use crate::link::{AcpBridge, StreamEvent};
use base64::Engine;
use include_dir::{include_dir, Dir};

/// 编译时嵌入的前端 SPA 静态文件（web/dist/）
static WEB_DIST: Dir = include_dir!("$CARGO_MANIFEST_DIR/web/dist");

/// web_send_file 事件：MCP tool 执行后推送给 SSE 流
#[derive(Debug, Clone)]
pub struct WebFileEvent {
    /// 关联的 session（用于路由到正确的 SSE 流）
    pub session: String,
    /// 文件名
    pub name: String,
    /// 可访问的 URL 路径
    pub url: String,
    /// 是否为图片
    pub is_image: bool,
}

/// 全局 file events 发送端，供 MCP tool 使用
static WEB_FILE_TX: std::sync::OnceLock<broadcast::Sender<WebFileEvent>> = std::sync::OnceLock::new();

/// 获取全局 file event sender
pub fn web_file_sender() -> &'static broadcast::Sender<WebFileEvent> {
    WEB_FILE_TX.get_or_init(|| {
        let (tx, _) = broadcast::channel(64);
        tx
    })
}

/// API Server 共享状态
struct ApiState {
    bridge: AcpBridge,
    cwd: PathBuf,
    /// chat_id → acp_session_id
    sessions: RwLock<HashMap<String, String>>,
    /// per-session 锁：同一 session 的请求串行执行
    session_locks: RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

/// 启动 API HTTP Server（与 MCP Server 共用端口，由调用方合并路由）
pub fn api_routes(bridge: AcpBridge, cwd: PathBuf) -> Router {
    let state = Arc::new(ApiState {
        bridge,
        cwd: cwd.clone(),
        sessions: RwLock::new(HashMap::new()),
        session_locks: RwLock::new(HashMap::new()),
    });

    Router::new()
        .route("/api/ask", post(handle_ask))
        .route("/api/upload", post(handle_upload))
        .route("/api/search", get(handle_search))
        .route("/api/chat/history", get(handle_chat_history_get))
        .route("/api/chat/history", post(handle_chat_history_post))
        .route("/api/files/{*path}", get(handle_files_api))
        .route("/api/files", get(handle_files_api_root))
        .route("/api/fs/create", post(handle_fs_create))
        .route("/api/fs/rename", post(handle_fs_rename))
        .route("/api/fs/delete", post(handle_fs_delete))
        .route("/api/fs/upload", post(handle_fs_upload))
        .with_state(state)
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024))
        .fallback_service(NotesService { root: cwd })
}

/// 静态文件服务，目录重定向到 SPA，文件直接下载
#[derive(Clone)]
struct NotesService {
    root: PathBuf,
}

impl tower::Service<Request> for NotesService {
    type Response = Response;
    type Error = std::convert::Infallible;
    type Future = std::pin::Pin<Box<dyn std::future::Future<Output = Result<Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _cx: &mut std::task::Context<'_>) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: Request) -> Self::Future {
        let root = self.root.clone();
        let path = req.uri().path().to_string();
        let range_header = req.headers().get("range").and_then(|v| v.to_str().ok()).map(|s| s.to_string());

        Box::pin(async move {
            // 优先处理 SPA 路由（assets、/notes/...、根路径）
            if let Some(resp) = serve_spa_file(&path) {
                return Ok(resp);
            }
            // 其他路径：目录重定向到 /notes/...，文件直接下载
            Ok(serve_or_redirect(&root, &path, range_header.as_deref()))
        })
    }
}

/// 从嵌入的 SPA 静态文件中响应（assets 精确匹配，其他路径返回 index.html）
fn serve_spa_file(path: &str) -> Option<Response> {
    let relative = path.trim_start_matches('/');

    // 前端静态资源（JS/CSS/字体等），精确匹配
    if relative.starts_with("assets/") || relative == "favicon.ico" {
        let file = WEB_DIST.get_file(relative)?;
        let mime = mime_guess::from_path(relative).first_or_octet_stream().to_string();
        return Some(
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", mime)
                .header("cache-control", "public, max-age=31536000, immutable")
                .body(Body::from(file.contents().to_vec()))
                .unwrap()
        );
    }

    // 只有 /notes 和 /notes/... 路径返回 SPA index.html
    if relative == "notes" || relative.starts_with("notes/") {
        let index = WEB_DIST.get_file("index.html")?;
        return Some(
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "text/html; charset=utf-8")
                .body(Body::from(index.contents().to_vec()))
                .unwrap()
        );
    }

    // 根路径 / 重定向到 /notes
    if relative.is_empty() {
        return Some(
            Response::builder()
                .status(StatusCode::FOUND)
                .header("location", "/notes")
                .body(Body::empty())
                .unwrap()
        );
    }

    // 其他路径交给 serve_or_redirect 处理
    None
}

/// 目录重定向到 /notes/{path}，文件直接返回供下载/查看（支持 Range 请求）
fn serve_or_redirect(root: &PathBuf, path: &str, range: Option<&str>) -> Response {
    let decoded = urlencoding::decode(path.trim_start_matches('/')).unwrap_or_default();
    let relative = decoded.as_ref();

    let file_path = if relative.is_empty() {
        root.clone()
    } else {
        root.join(relative)
    };

    // 安全检查：防止路径穿越（不用 canonicalize，iCloud 路径有问题）
    if relative.contains("..") {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::from("Forbidden"))
            .unwrap();
    }

    if !file_path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap();
    }

    // 目录 → 重定向到 /notes/{path}
    if file_path.is_dir() {
        return Response::builder()
            .status(StatusCode::FOUND)
            .header("location", format!("/notes/{}", relative))
            .body(Body::empty())
            .unwrap();
    }

    // 获取文件大小
    let file_len = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);

    let mime = mime_guess::from_path(&file_path)
        .first_or_octet_stream()
        .to_string();

    // 文本类型加 charset=utf-8 防止中文乱码
    let content_type = if mime.starts_with("text/") {
        format!("{}; charset=utf-8", mime)
    } else {
        mime
    };

    // 处理 Range 请求
    if let Some(range_str) = range {
        if let Some((start, end)) = parse_range(range_str, file_len) {
            let len = end - start + 1;
            // 读取指定范围
            use std::io::{Read, Seek, SeekFrom};
            let mut file = match std::fs::File::open(&file_path) {
                Ok(f) => f,
                Err(_) => return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("Read error"))
                    .unwrap(),
            };
            let _ = file.seek(SeekFrom::Start(start));
            let mut buf = vec![0u8; len as usize];
            let _ = file.read_exact(&mut buf);

            return Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header("content-type", &content_type)
                .header("content-length", len.to_string())
                .header("content-range", format!("bytes {}-{}/{}", start, end, file_len))
                .header("accept-ranges", "bytes")
                .header("access-control-allow-origin", "*")
                .body(Body::from(buf))
                .unwrap();
        }
    }

    // 正常完整返回
    let data = match std::fs::read(&file_path) {
        Ok(d) => d,
        Err(_) => return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("Read error"))
            .unwrap(),
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", content_type)
        .header("content-length", file_len.to_string())
        .header("accept-ranges", "bytes")
        .header("access-control-allow-origin", "*")
        .body(Body::from(data))
        .unwrap()
}

/// 解析 Range 头，返回 (start, end) 字节范围
fn parse_range(range: &str, file_len: u64) -> Option<(u64, u64)> {
    // 格式: "bytes=start-end" 或 "bytes=start-" 或 "bytes=-suffix"
    let s = range.strip_prefix("bytes=")?;
    let (start_str, end_str) = s.split_once('-')?;

    if start_str.is_empty() {
        // bytes=-500 → 最后 500 字节
        let suffix: u64 = end_str.parse().ok()?;
        let start = file_len.saturating_sub(suffix);
        Some((start, file_len - 1))
    } else {
        let start: u64 = start_str.parse().ok()?;
        let end = if end_str.is_empty() {
            file_len - 1
        } else {
            end_str.parse::<u64>().ok()?.min(file_len - 1)
        };
        if start > end || start >= file_len {
            return None;
        }
        Some((start, end))
    }
}

/// 解析 data URI，返回 (mime, base64_data)
fn parse_data_uri(input: &str) -> (String, &str) {
    if let Some(comma_pos) = input.find(',') {
        let header = &input[..comma_pos];
        let mime = header
            .strip_prefix("data:")
            .and_then(|s| s.strip_suffix(";base64"))
            .unwrap_or("image/png");
        (mime.to_string(), &input[comma_pos + 1..])
    } else {
        ("image/png".to_string(), input)
    }
}

/// 判断文件扩展名是否为可渲染的代码/文本文件
fn is_code_file(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "json" | "yaml" | "yml" | "toml" | "xml"
            | "rs" | "py" | "js" | "ts" | "jsx" | "tsx"
            | "go" | "java" | "c" | "cpp" | "h" | "hpp"
            | "sh" | "bash" | "zsh" | "fish"
            | "rb" | "swift" | "kt" | "kts"
            | "css" | "scss" | "less" | "html" | "htm"
            | "sql" | "graphql" | "gql"
            | "dockerfile" | "makefile"
            | "txt" | "log" | "env" | "ini" | "cfg" | "conf"
            | "csv"
    )
}

#[derive(serde::Deserialize)]
struct AskBody {
    /// 简单模式：纯文字提问
    question: Option<String>,
    session: Option<String>,
    /// 有序 blocks（图文混排模式）
    #[serde(default)]
    blocks: Vec<AskBlock>,
    /// 兼容旧格式
    #[serde(default)]
    images: Vec<String>,
    #[serde(default)]
    files: Vec<AskFile>,
    context_path: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "type")]
enum AskBlock {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "image")]
    Image { data: String },
    #[serde(rename = "file")]
    File { name: String, data: String },
}

#[derive(serde::Deserialize)]
struct AskFile {
    name: String,
    data: String,
}

/// GET /api/search?q=keyword — 全局递归搜索文件名
async fn handle_search(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let query = params.get("q").map(|s| s.as_str()).unwrap_or("");
    if query.is_empty() {
        return Json(serde_json::json!({"results": []})).into_response();
    }

    let q = query.to_lowercase();
    let root = &state.cwd;
    let mut results: Vec<serde_json::Value> = Vec::new();

    // 递归遍历文件树，匹配文件名
    fn walk(dir: &std::path::Path, root: &std::path::Path, q: &str, results: &mut Vec<serde_json::Value>, depth: usize) {
        if depth > 10 || results.len() >= 50 { return; }
        let Ok(read_dir) = std::fs::read_dir(dir) else { return };
        for entry in read_dir.flatten() {
            if results.len() >= 50 { return; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

            if name.to_lowercase().contains(q) {
                let rel = entry.path().strip_prefix(root)
                    .unwrap_or(entry.path().as_path())
                    .to_string_lossy()
                    .to_string();
                results.push(serde_json::json!({
                    "name": name,
                    "path": rel,
                    "is_dir": is_dir,
                }));
            }

            if is_dir {
                walk(&entry.path(), root, q, results, depth + 1);
            }
        }
    }

    walk(root, root, &q, &mut results, 0);

    Json(serde_json::json!({"results": results})).into_response()
}

/// GET /api/files — 根目录文件列表 JSON
async fn handle_files_api_root(
    State(state): State<Arc<ApiState>>,
    query: axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let show_hidden = query.get("hidden").map(|v| v == "true").unwrap_or(false);
    handle_files_json(&state.cwd, "", show_hidden).await
}

/// GET /api/files/*path — 文件/目录信息 JSON
async fn handle_files_api(
    State(state): State<Arc<ApiState>>,
    Path(path): Path<String>,
    query: axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let show_hidden = query.get("hidden").map(|v| v == "true").unwrap_or(false);
    handle_files_json(&state.cwd, &path, show_hidden).await
}

async fn handle_files_json(root: &PathBuf, relative: &str, show_hidden: bool) -> Response {
    let decoded = urlencoding::decode(relative.trim_start_matches('/')).unwrap_or_default();
    let rel = decoded.as_ref();

    let file_path = if rel.is_empty() { root.clone() } else { root.join(rel) };

    if !file_path.exists() {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "not found"}))).into_response();
    }

    // 安全检查
    let abs_root = std::fs::canonicalize(root).unwrap_or(root.clone());
    let abs_file = std::fs::canonicalize(&file_path).unwrap_or(file_path.clone());
    if !abs_file.starts_with(&abs_root) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "forbidden"}))).into_response();
    }

    // 目录
    if file_path.is_dir() {
        let mut entries = Vec::new();
        if let Ok(read_dir) = std::fs::read_dir(&file_path) {
            for entry in read_dir.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !show_hidden && name.starts_with('.') { continue; }
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let ext = if is_dir {
                    String::new()
                } else {
                    std::path::Path::new(&name)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_string()
                };
                entries.push(serde_json::json!({"name": name, "is_dir": is_dir, "ext": ext}));
            }
        }
        // 排序：目录在前
        entries.sort_by(|a, b| {
            let a_dir = a["is_dir"].as_bool().unwrap_or(false);
            let b_dir = b["is_dir"].as_bool().unwrap_or(false);
            match (a_dir, b_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")),
            }
        });

        return Json(serde_json::json!({
            "type": "directory",
            "path": rel,
            "entries": entries
        })).into_response();
    }

    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();

    // Markdown
    if ext == "md" {
        let content = std::fs::read_to_string(&file_path).unwrap_or_default();
        return Json(serde_json::json!({
            "type": "markdown",
            "path": rel,
            "content": content
        })).into_response();
    }

    // 代码/文本文件
    if is_code_file(&ext) {
        let content = std::fs::read_to_string(&file_path).unwrap_or_default();
        let line_count = content.lines().count();
        let file_size = content.len();
        let size_str = if file_size < 1024 {
            format!("{file_size} B")
        } else if file_size < 1024 * 1024 {
            format!("{:.1} KB", file_size as f64 / 1024.0)
        } else {
            format!("{:.1} MB", file_size as f64 / (1024.0 * 1024.0))
        };
        return Json(serde_json::json!({
            "type": "code",
            "path": rel,
            "content": content,
            "ext": ext,
            "line_count": line_count,
            "size": size_str
        })).into_response();
    }

    // 二进制/其他
    Json(serde_json::json!({
        "type": "binary",
        "path": rel
    })).into_response()
}

/// POST /api/upload — 上传文件到 .tmp/uploads/，返回服务端路径
async fn handle_upload(
    State(state): State<Arc<ApiState>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let upload_dir = state.cwd.join(".tmp/uploads");
    let _ = std::fs::create_dir_all(&upload_dir);

    // 从 header 取文件名
    let filename = headers.get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(|s| urlencoding::decode(s).unwrap_or_default().to_string())
        .unwrap_or_else(|| format!("upload-{}", uuid::Uuid::new_v4()));

    let safe_name = filename.replace('/', "_").replace('\\', "_");
    // 加时间戳避免覆盖
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    let final_name = format!("{ts}-{safe_name}");
    let file_path = upload_dir.join(&final_name);

    if let Err(e) = std::fs::write(&file_path, &body) {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("写入失败: {e}")).into_response();
    }

    let path_str = format!(".tmp/uploads/{final_name}");
    let _abs_path_str = file_path.to_string_lossy().to_string();
    let is_image = safe_name.to_lowercase().ends_with(".png")
        || safe_name.to_lowercase().ends_with(".jpg")
        || safe_name.to_lowercase().ends_with(".jpeg")
        || safe_name.to_lowercase().ends_with(".gif")
        || safe_name.to_lowercase().ends_with(".webp")
        || safe_name.to_lowercase().ends_with(".bmp");

    let resp = serde_json::json!({
        "path": path_str,
        "name": safe_name,
        "size": body.len(),
        "is_image": is_image,
    });

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .header("access-control-allow-origin", "*")
        .body(Body::from(resp.to_string()))
        .unwrap()
}

/// POST /api/ask — SSE 流式问答
async fn handle_ask(
    State(state): State<Arc<ApiState>>,
    body: String,
) -> Response {
    let parsed: AskBody = serde_json::from_str(&body).unwrap_or(AskBody {
        question: Some(body.clone()),
        session: None,
        blocks: vec![],
        images: vec![],
        files: vec![],
        context_path: None,
    });
    let question = parsed.question.unwrap_or(body);
    let chat_id = parsed.session.unwrap_or_else(|| "default".to_string());

    if question.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "question is required").into_response();
    }

    // per-session 锁：同一 session 的请求排队执行
    let session_mutex = {
        let read_guard = state.session_locks.read().await;
        if let Some(m) = read_guard.get(&chat_id) {
            m.clone()
        } else {
            drop(read_guard);
            let mut write_guard = state.session_locks.write().await;
            write_guard
                .entry(chat_id.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        }
    };
    let _session_guard = session_mutex.lock().await;

    // 获取或创建 session（带重试，应对 worker busy）
    let session_id = {
        let sessions = state.sessions.read().await;
        sessions.get(&chat_id).cloned()
    };

    let session_id = match session_id {
        Some(sid) => {
            // load_session 带重试
            let mut retries = 0u32;
            loop {
                match state.bridge.load_session(&chat_id, &sid, state.cwd.clone()).await {
                    Ok(_) => break,
                    Err(e) if retries < 3 && format!("{e}").contains("正在处理") => {
                        retries += 1;
                        tokio::time::sleep(tokio::time::Duration::from_millis(500 * u64::from(retries))).await;
                    }
                    Err(_) => break, // 非 busy 错误忽略，后续 prompt 可能仍能工作
                }
            }
            sid
        }
        None => {
            // new_session 带重试
            let mut retries = 0u32;
            let mut last_err = String::new();
            let sid = loop {
                match state.bridge.new_session(&chat_id, state.cwd.clone()).await {
                    Ok(sid) => break Some(sid),
                    Err(e) if retries < 5 && format!("{e}").contains("正在处理") => {
                        retries += 1;
                        last_err = format!("{e}");
                        tokio::time::sleep(tokio::time::Duration::from_millis(500 * u64::from(retries))).await;
                    }
                    Err(e) => {
                        last_err = format!("{e}");
                        break None;
                    }
                }
            };
            match sid {
                Some(sid) => {
                    state.sessions.write().await.insert(chat_id.clone(), sid.clone());
                    sid
                }
                None => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to create session: {last_err}"),
                    ).into_response();
                }
            }
        }
    };

    // 构建 prompt blocks
    let mut blocks = Vec::new();

    // 添加上下文路径提示
    if let Some(ref ctx_path) = parsed.context_path {
        if !ctx_path.is_empty() {
            blocks.push(AcpBridge::text_block(&format!("[context_path: {}]", ctx_path)));
        }
    }

    // 注入 im_context，告知 agent 使用 web_send_file 发送文件
    blocks.push(AcpBridge::text_block(&format!(
        "[im_context: chat_id={}, send_file_tool=web_send_file, session={}]",
        chat_id, chat_id
    )));

    if !parsed.blocks.is_empty() {
        // 有序 blocks 模式（图文混排）
        let upload_dir = state.cwd.join(".tmp/uploads");
        let _ = std::fs::create_dir_all(&upload_dir);

        for block in &parsed.blocks {
            match block {
                AskBlock::Text { content } => {
                    if !content.is_empty() {
                        blocks.push(AcpBridge::text_block(content));
                    }
                }
                AskBlock::Image { data } => {
                    // data 可以是 base64 data URI 或服务端文件路径
                    if data.starts_with("/") || data.starts_with("./") {
                        // 本地文件路径——直接读取
                        if let Ok(bytes) = std::fs::read(&data) {
                            let ext = std::path::Path::new(data.as_str()).extension().and_then(|e| e.to_str()).unwrap_or("png");
                            let mime = format!("image/{}", ext);
                            blocks.push(AcpBridge::image_block(&bytes, &mime));
                        }
                    } else {
                        let (mime, raw) = parse_data_uri(&data);
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw) {
                            blocks.push(AcpBridge::image_block(&bytes, &mime));
                        }
                    }
                }
                AskBlock::File { name, data } => {
                    // data 可以是 base64 data URI 或服务端文件路径
                    let file_path = if data.starts_with("/") || data.starts_with("./") {
                        PathBuf::from(&data)
                    } else {
                        let (_, raw) = parse_data_uri(&data);
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw) {
                            let safe_name = name.replace('/', "_").replace('\\', "_");
                            let p = upload_dir.join(&safe_name);
                            let _ = std::fs::write(&p, &bytes);
                            p
                        } else {
                            continue;
                        }
                    };
                    blocks.push(AcpBridge::text_block(&format!(
                        "[attached_file: {} ({})]", file_path.display(), name
                    )));
                }
            }
        }
    } else {
        // 兼容旧格式：question + images + files
        blocks.push(AcpBridge::text_block(&question));

        for img_b64 in &parsed.images {
            let (mime, raw) = parse_data_uri(img_b64);
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw) {
                blocks.push(AcpBridge::image_block(&bytes, &mime));
            }
        }

        if !parsed.files.is_empty() {
            let upload_dir = state.cwd.join(".tmp/uploads");
            let _ = std::fs::create_dir_all(&upload_dir);
            for file in &parsed.files {
                let (_, raw) = parse_data_uri(&file.data);
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw) {
                    let safe_name = file.name.replace('/', "_").replace('\\', "_");
                    let file_path = upload_dir.join(&safe_name);
                    if std::fs::write(&file_path, &bytes).is_ok() {
                        blocks.push(AcpBridge::text_block(&format!(
                            "[attached_file: {} ({})]", file_path.display(), safe_name
                        )));
                    }
                }
            }
        }
    }

    // 发送 prompt 并获取流（带重试）
    let rx = {
        let mut retries = 0u32;
        loop {
            match state.bridge.prompt_stream(&chat_id, &session_id, blocks.clone()).await {
                Ok(rx) => break rx,
                Err(e) if retries < 3 && format!("{e}").contains("正在处理") => {
                    retries += 1;
                    tokio::time::sleep(tokio::time::Duration::from_millis(500 * u64::from(retries))).await;
                }
                Err(e) => {
                    state.sessions.write().await.remove(&chat_id);
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Prompt failed: {e}"),
                    ).into_response();
                }
            }
        }
    };

    // SSE stream — 同时监听 ACP 流和 web_send_file 事件
    let mut file_rx = web_file_sender().subscribe();
    let target_session = chat_id.clone();
    let sessions_for_stream = state.clone();
    let chat_id_for_stream = chat_id.clone();
    let stream = async_stream::stream! {
        let mut rx = rx;
        let mut got_content = false;
        loop {
            tokio::select! {
                biased;
                event = rx.recv() => {
                    match event {
                        Some(StreamEvent::Text(t)) => {
                            got_content = true;
                            let data = serde_json::json!({"type": "text", "content": t});
                            yield Ok::<_, std::convert::Infallible>(format!("data: {}\n\n", data));
                        }
                        Some(StreamEvent::ToolCall(t)) => {
                            got_content = true;
                            let data = serde_json::json!({"type": "tool", "content": t});
                            yield Ok::<_, std::convert::Infallible>(format!("data: {}\n\n", data));
                        }
                        None => {
                            // ACP 流结束
                            if !got_content {
                                // 没有收到任何内容就结束了 — prompt 可能失败
                                // 清除 session 让下次重建
                                sessions_for_stream.sessions.write().await.remove(&chat_id_for_stream);
                                let err_data = serde_json::json!({
                                    "type": "text",
                                    "content": "⚠️ 连接中断，请重试。如果问题持续，请尝试「新对话」。"
                                });
                                yield Ok(format!("data: {}\n\n", err_data));
                            }
                            break;
                        }
                    }
                }
                file_ev = file_rx.recv() => {
                    if let Ok(ev) = file_ev {
                        if ev.session == target_session {
                            let data = serde_json::json!({
                                "type": "file",
                                "name": ev.name,
                                "url": ev.url,
                                "is_image": ev.is_image,
                            });
                            yield Ok::<_, std::convert::Infallible>(format!("data: {}\n\n", data));
                        }
                    }
                }
            }
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

/// 共享聊天记录存储目录
fn chat_history_dir() -> PathBuf {
    crate::config::AppConfig::data_dir()
        .parent()
        .unwrap_or(&PathBuf::from("."))
        .join("chat")
}

/// 根据路径生成安全的文件名
fn path_to_chat_filename(path: &str) -> String {
    let clean = path.trim_start_matches('/').replace('/', "__");
    if clean.is_empty() { "_root_.json".to_string() } else { format!("{clean}.json") }
}

/// GET /api/chat/history?path=xxx — 获取共享聊天记录
async fn handle_chat_history_get(
    query: axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let path = query.get("path").map(|s| s.as_str()).unwrap_or("");
    let dir = chat_history_dir();
    let file = dir.join(path_to_chat_filename(path));

    if !file.exists() {
        return Json(serde_json::json!({ "messages": [] })).into_response();
    }

    match std::fs::read_to_string(&file) {
        Ok(content) => {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(val) => Json(val).into_response(),
                Err(_) => Json(serde_json::json!({ "messages": [] })).into_response(),
            }
        }
        Err(_) => Json(serde_json::json!({ "messages": [] })).into_response(),
    }
}

/// POST /api/chat/history — 保存共享聊天记录
/// Body: { "path": "xxx", "messages": [...] }
async fn handle_chat_history_post(
    body: String,
) -> Response {
    let parsed: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid json").into_response(),
    };

    let path = parsed.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let messages = parsed.get("messages");

    if messages.is_none() {
        return (StatusCode::BAD_REQUEST, "messages required").into_response();
    }

    let dir = chat_history_dir();
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join(path_to_chat_filename(path));

    let data = serde_json::json!({
        "path": path,
        "messages": messages,
        "session": parsed.get("session").and_then(|v| v.as_str()).unwrap_or(""),
        "updated_at": chrono::Utc::now().to_rfc3339(),
    });

    match std::fs::write(&file, serde_json::to_string_pretty(&data).unwrap_or_default()) {
        Ok(_) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("write failed: {e}")).into_response(),
    }
}

// ========== 文件管理 API ==========

/// POST /api/fs/create — 创建文件或文件夹
/// Body: { "path": "相对路径", "is_dir": bool }
async fn handle_fs_create(
    State(state): State<Arc<ApiState>>,
    body: String,
) -> Response {
    let parsed: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "invalid json"}))).into_response(),
    };

    let rel_path = match parsed.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "path required"}))).into_response(),
    };
    let is_dir = parsed.get("is_dir").and_then(|v| v.as_bool()).unwrap_or(false);

    let target = state.cwd.join(rel_path);

    // 安全检查
    let abs_root = std::fs::canonicalize(&state.cwd).unwrap_or(state.cwd.clone());
    // 目标可能不存在，检查其父目录
    if let Some(parent) = target.parent() {
        if parent.exists() {
            let abs_parent = std::fs::canonicalize(parent).unwrap_or(parent.to_path_buf());
            if !abs_parent.starts_with(&abs_root) {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "forbidden"}))).into_response();
            }
        }
    }

    if target.exists() {
        return (StatusCode::CONFLICT, Json(serde_json::json!({"error": "already exists"}))).into_response();
    }

    if is_dir {
        if let Err(e) = std::fs::create_dir_all(&target) {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("{e}")}))).into_response();
        }
    } else {
        // 确保父目录存在
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&target, "") {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("{e}")}))).into_response();
        }
    }

    Json(serde_json::json!({"ok": true})).into_response()
}

/// POST /api/fs/rename — 重命名文件或文件夹
/// Body: { "path": "原路径", "new_name": "新名称" }
async fn handle_fs_rename(
    State(state): State<Arc<ApiState>>,
    body: String,
) -> Response {
    let parsed: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "invalid json"}))).into_response(),
    };

    let rel_path = match parsed.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "path required"}))).into_response(),
    };
    let new_name = match parsed.get("new_name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "new_name required"}))).into_response(),
    };

    // 文件名安全检查
    if new_name.contains('/') || new_name.contains('\\') || new_name == "." || new_name == ".." {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "invalid name"}))).into_response();
    }

    let source = state.cwd.join(rel_path);
    let target = source.parent().unwrap_or(&state.cwd).join(new_name);

    // 安全检查
    let abs_root = std::fs::canonicalize(&state.cwd).unwrap_or(state.cwd.clone());
    if source.exists() {
        let abs_source = std::fs::canonicalize(&source).unwrap_or(source.clone());
        if !abs_source.starts_with(&abs_root) {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "forbidden"}))).into_response();
        }
    } else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "not found"}))).into_response();
    }

    if target.exists() {
        return (StatusCode::CONFLICT, Json(serde_json::json!({"error": "target already exists"}))).into_response();
    }

    if let Err(e) = std::fs::rename(&source, &target) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("{e}")}))).into_response();
    }

    Json(serde_json::json!({"ok": true})).into_response()
}

/// POST /api/fs/delete — 删除文件或文件夹
/// Body: { "path": "相对路径" }
async fn handle_fs_delete(
    State(state): State<Arc<ApiState>>,
    body: String,
) -> Response {
    let parsed: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "invalid json"}))).into_response(),
    };

    let rel_path = match parsed.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "path required"}))).into_response(),
    };

    let target = state.cwd.join(rel_path);

    // 安全检查
    let abs_root = std::fs::canonicalize(&state.cwd).unwrap_or(state.cwd.clone());
    if target.exists() {
        let abs_target = std::fs::canonicalize(&target).unwrap_or(target.clone());
        if !abs_target.starts_with(&abs_root) {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "forbidden"}))).into_response();
        }
    } else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "not found"}))).into_response();
    }

    // 不允许删除根目录
    if rel_path.is_empty() || rel_path == "/" {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "cannot delete root"}))).into_response();
    }

    let result = if target.is_dir() {
        std::fs::remove_dir_all(&target)
    } else {
        std::fs::remove_file(&target)
    };

    match result {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("{e}")}))).into_response(),
    }
}

/// POST /api/fs/upload — 上传文件到指定目录
/// Headers: X-Filename (文件名), X-Dir (目标目录相对路径，可选，默认根目录)
async fn handle_fs_upload(
    State(state): State<Arc<ApiState>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    // 目标目录
    let dir_rel = headers.get("x-dir")
        .and_then(|v| v.to_str().ok())
        .map(|s| urlencoding::decode(s).unwrap_or_default().to_string())
        .unwrap_or_default();

    // 文件名
    let filename = headers.get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(|s| urlencoding::decode(s).unwrap_or_default().to_string())
        .unwrap_or_else(|| format!("upload-{}", uuid::Uuid::new_v4()));

    let safe_name = filename.replace('/', "_").replace('\\', "_");

    // 目标目录路径
    let target_dir = if dir_rel.is_empty() {
        state.cwd.clone()
    } else {
        state.cwd.join(&dir_rel)
    };

    // 安全检查
    let abs_root = std::fs::canonicalize(&state.cwd).unwrap_or(state.cwd.clone());
    if target_dir.exists() {
        let abs_dir = std::fs::canonicalize(&target_dir).unwrap_or(target_dir.clone());
        if !abs_dir.starts_with(&abs_root) {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "forbidden"}))).into_response();
        }
    } else {
        // 目录不存在则创建
        if let Err(e) = std::fs::create_dir_all(&target_dir) {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("mkdir: {e}")}))).into_response();
        }
    }

    // 如果目标文件已存在，加序号避免覆盖
    let mut final_name = safe_name.clone();
    let mut file_path = target_dir.join(&final_name);
    if file_path.exists() {
        let stem = std::path::Path::new(&safe_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&safe_name)
            .to_string();
        let ext = std::path::Path::new(&safe_name)
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{s}"))
            .unwrap_or_default();
        let mut i = 1u32;
        loop {
            final_name = format!("{stem}_{i}{ext}");
            file_path = target_dir.join(&final_name);
            if !file_path.exists() { break; }
            i += 1;
            if i > 999 { break; } // 安全上限
        }
    }

    if let Err(e) = std::fs::write(&file_path, &body) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("write: {e}")}))).into_response();
    }

    // 返回相对路径
    let rel_path = if dir_rel.is_empty() {
        final_name.clone()
    } else {
        format!("{}/{}", dir_rel, final_name)
    };

    Json(serde_json::json!({
        "ok": true,
        "name": final_name,
        "path": rel_path,
        "size": body.len(),
    })).into_response()
}
