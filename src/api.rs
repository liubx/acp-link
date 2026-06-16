//! HTTP API — `/api/ask` SSE 流式问答端点
//!
//! 提供 HTTP 接口直接与 agent 对话，返回 SSE 流。
//! 复用 AcpBridge 进程池和 session 管理。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State, Path};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response, Json};
use axum::routing::{post, get};
use tokio::sync::{RwLock, broadcast};

use crate::link::{AcpBridge, StreamEvent};
use crate::chat::chat_widget;
use base64::Engine;
use include_dir::{include_dir, Dir};

/// 编译时嵌入的前端 SPA 静态文件（web/dist/）
static WEB_DIST: Dir = include_dir!("$CARGO_MANIFEST_DIR/web/dist");

/// 编译时嵌入的静态资源
const STYLE_CSS: &str = include_str!("web/static/style.css");
const DIRECTORY_CSS: &str = include_str!("web/static/directory.css");
const MARKDOWN_CSS: &str = include_str!("web/static/markdown.css");
const CODE_CSS: &str = include_str!("web/static/code.css");
const THEME_JS: &str = include_str!("web/static/theme.js");

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
}

/// 启动 API HTTP Server（与 MCP Server 共用端口，由调用方合并路由）
pub fn api_routes(bridge: AcpBridge, cwd: PathBuf) -> Router {
    let state = Arc::new(ApiState {
        bridge,
        cwd: cwd.clone(),
        sessions: RwLock::new(HashMap::new()),
    });

    Router::new()
        .route("/api/ask", post(handle_ask))
        .route("/api/upload", post(handle_upload))
        .route("/api/files/{*path}", get(handle_files_api))
        .route("/api/files", get(handle_files_api_root))
        .with_state(state)
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024))
        .fallback_service(NotesService { root: cwd })
}

/// 静态文件服务，.md 自动渲染为 HTML
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

        Box::pin(async move {
            // 优先尝试从嵌入的前端 SPA 文件中响应
            if let Some(resp) = serve_spa_file(&path) {
                return Ok(resp);
            }
            // 否则 fallback 到原来的笔记文件渲染
            Ok(serve_notes_file(&root, &path).await)
        })
    }
}

/// 从嵌入的 SPA 静态文件中响应（assets 精确匹配，其他路径返回 index.html）
fn serve_spa_file(path: &str) -> Option<Response> {
    let relative = path.trim_start_matches('/');

    // 如果请求的是静态资源文件（JS/CSS/图片等），精确匹配
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

    // 对于非 API、非实际文件系统路径的请求，返回 SPA 的 index.html
    // 但如果路径看起来像是实际笔记文件（有扩展名或存在于文件系统），则不拦截
    if relative.is_empty() || relative == "index.html" {
        let index = WEB_DIST.get_file("index.html")?;
        return Some(
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "text/html; charset=utf-8")
                .body(Body::from(index.contents().to_vec()))
                .unwrap()
        );
    }

    None
}

/// 处理 /notes 下的文件请求
async fn serve_notes_file(root: &PathBuf, path: &str) -> Response {
    // URL decode + 去掉开头的 /
    let decoded = urlencoding::decode(path.trim_start_matches('/')).unwrap_or_default();
    let relative = decoded.as_ref();

    // 空路径或根目录 → 显示目录列表
    let file_path = if relative.is_empty() {
        root.clone()
    } else {
        root.join(relative)
    };

    tracing::debug!("NotesService: path={path} relative={relative} file_path={}", file_path.display());

    // 不用 canonicalize（iCloud 路径可能有问题），直接检查存在性
    if !file_path.exists() {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    // 安全检查：防止路径穿越
    let abs_root = std::fs::canonicalize(root).unwrap_or(root.clone());
    let abs_file = std::fs::canonicalize(&file_path).unwrap_or(file_path.clone());
    if !abs_file.starts_with(&abs_root) {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }

    // 目录 → 生成目录列表
    if file_path.is_dir() {
        return render_directory(&file_path, relative).into_response();
    }

    // .md 文件 → 渲染为 HTML
    if relative.ends_with(".md") || file_path.extension().and_then(|e| e.to_str()) == Some("md") {
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Read error").into_response(),
        };
        let html = render_markdown(&content, relative);
        return Html(html).into_response();
    }

    // 代码/文本文件 → 语法高亮渲染
    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if is_code_file(ext) {
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Read error").into_response(),
        };
        let html = render_code_file(&content, ext, relative);
        return Html(html).into_response();
    }

    // 其他文件 → 直接返回
    let data = match std::fs::read(&file_path) {
        Ok(d) => d,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Read error").into_response(),
    };

    let mime = mime_guess::from_path(&file_path)
        .first_or_octet_stream()
        .to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", mime)
        .header("access-control-allow-origin", "*")
        .body(Body::from(data))
        .unwrap()
}

/// 渲染目录列表为 HTML（暗色主题）
fn render_directory(dir_path: &PathBuf, relative: &str) -> Html<String> {
    let mut entries: Vec<(String, bool)> = Vec::new();

    if let Ok(read_dir) = std::fs::read_dir(dir_path) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push((name, is_dir));
        }
    }

    entries.sort_by(|a, b| match (a.1, b.1) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.0.cmp(&b.0),
    });

    // 面包屑
    let breadcrumb = if relative.is_empty() {
        r#"<span class="sep">/</span>"#.to_string()
    } else {
        let parts: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
        let mut bc = String::new();
        let mut acc = String::new();
        for (i, part) in parts.iter().enumerate() {
            acc = if acc.is_empty() { part.to_string() } else { format!("{acc}/{part}") };
            bc.push_str(r#"<span class="sep">/</span>"#);
            if i == parts.len() - 1 {
                bc.push_str(&format!(r#"<span class="current">{part}</span>"#));
            } else {
                bc.push_str(&format!(r#"<a href="/{}">{part}</a>"#, urlencoding::encode(&acc)));
            }
        }
        bc
    };

    let mut items_html = String::new();

    for (name, is_dir) in &entries {
        let href = if relative.is_empty() {
            format!("/{}", urlencoding::encode(name))
        } else {
            format!("/{}/{}", urlencoding::encode(relative), urlencoding::encode(name))
        };
        let class = if *is_dir {
            "dir"
        } else if name.ends_with(".md") {
            "md"
        } else if name.ends_with(".json") || name.ends_with(".yaml") || name.ends_with(".yml") || name.ends_with(".toml") {
            "config"
        } else if name.ends_with(".rs") || name.ends_with(".py") || name.ends_with(".js") || name.ends_with(".ts")
            || name.ends_with(".go") || name.ends_with(".java") || name.ends_with(".c") || name.ends_with(".cpp")
            || name.ends_with(".sh") || name.ends_with(".rb") || name.ends_with(".swift") || name.ends_with(".kt") {
            "code"
        } else if name.ends_with(".png") || name.ends_with(".jpg") || name.ends_with(".jpeg")
            || name.ends_with(".gif") || name.ends_with(".svg") || name.ends_with(".webp") {
            "image"
        } else {
            "file"
        };
        items_html.push_str(&format!(
            r#"<div class="entry {class}"><a href="{href}">{name}</a></div>"#
        ));
    }

    let chat_widget = chat_widget();
    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>/{relative}</title>
<style>{css_base}{css_page}</style>
<script>{theme_js}</script>
</head><body class="page-directory">
<button class="theme-toggle" onclick="toggleTheme()"></button>
<div class="pathbar"><a href="/" class="home"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</div>
<div class="file-list">
{items_html}
</div>{chat_widget}</body></html>"#,
        relative = relative,
        css_base = STYLE_CSS,
        css_page = DIRECTORY_CSS,
        theme_js = THEME_JS,
        breadcrumb = breadcrumb,
        items_html = items_html,
        chat_widget = chat_widget,
    );

    Html(html)
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

/// 将 Markdown 渲染为带样式的 HTML 页面（含面包屑导航）
fn render_markdown(md: &str, relative: &str) -> String {
    use pulldown_cmark::{Parser, Options, html};

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(md, options);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);

    // 面包屑
    let parts: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
    let mut breadcrumb = String::new();
    let mut acc = String::new();
    for (i, part) in parts.iter().enumerate() {
        acc = if acc.is_empty() { part.to_string() } else { format!("{acc}/{part}") };
        breadcrumb.push_str(r#"<span class="sep">/</span>"#);
        if i == parts.len() - 1 {
            // 最后一段是文件名
            breadcrumb.push_str(&format!(r#"<span class="current">{part}</span>"#));
        } else {
            breadcrumb.push_str(&format!(r#"<a href="/{}">{part}</a>"#, urlencoding::encode(&acc)));
        }
    }

    let chat_widget = chat_widget();
    format!(r#"<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{relative}</title>
<style>{css_base}{css_page}</style>
<script>{theme_js}</script>
</head><body class="page-markdown">
<button class="theme-toggle" onclick="toggleTheme()"></button>
<div class="pathbar"><a href="/" class="home"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</div>
<div class="content">{html_output}</div>
{chat_widget}</body></html>"#,
        relative = relative,
        css_base = STYLE_CSS,
        css_page = MARKDOWN_CSS,
        theme_js = THEME_JS,
        breadcrumb = breadcrumb,
        html_output = html_output,
        chat_widget = chat_widget,
    )
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

/// 将代码文件渲染为带语法高亮的 HTML 页面
fn render_code_file(content: &str, ext: &str, relative: &str) -> String {
    use syntect::highlighting::ThemeSet;
    use syntect::html::highlighted_html_for_string;
    use syntect::parsing::SyntaxSet;

    let ss = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();

    // 根据扩展名查找语法定义
    let syntax = ss.find_syntax_by_extension(ext)
        .or_else(|| ss.find_syntax_by_extension(&ext.to_lowercase()))
        .unwrap_or_else(|| ss.find_syntax_plain_text());

    // 使用 base16-ocean.dark 主题
    let theme = &ts.themes["base16-ocean.dark"];
    let highlighted = highlighted_html_for_string(content, &ss, syntax, theme)
        .unwrap_or_else(|_| format!("<pre><code>{}</code></pre>", content));

    // 包裹行号
    let lines: Vec<&str> = highlighted
        .trim_start_matches("<pre style=\"background-color:#2b303b;\">")
        .trim_end_matches("</pre>")
        .trim_start_matches('\n')
        .split('\n')
        .collect();

    let mut code_html = String::from("<table class=\"code-table\"><tbody>");
    for (i, line) in lines.iter().enumerate() {
        let num = i + 1;
        code_html.push_str(&format!(
            "<tr><td class=\"ln\">{num}</td><td class=\"code\">{line}</td></tr>"
        ));
    }
    code_html.push_str("</tbody></table>");

    // 面包屑
    let parts: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
    let mut breadcrumb = String::new();
    let mut acc = String::new();
    for (i, part) in parts.iter().enumerate() {
        acc = if acc.is_empty() { part.to_string() } else { format!("{acc}/{part}") };
        breadcrumb.push_str(r#"<span class="sep">/</span>"#);
        if i == parts.len() - 1 {
            breadcrumb.push_str(&format!(r#"<span class="current">{part}</span>"#));
        } else {
            breadcrumb.push_str(&format!(r#"<a href="/{}">{part}</a>"#, urlencoding::encode(&acc)));
        }
    }

    let line_count = content.lines().count();
    let file_size = content.len();
    let size_str = if file_size < 1024 {
        format!("{file_size} B")
    } else if file_size < 1024 * 1024 {
        format!("{:.1} KB", file_size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", file_size as f64 / (1024.0 * 1024.0))
    };

    let chat_widget = chat_widget();
    format!(r#"<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{relative}</title>
<style>{css_base}{css_page}</style>
<script>{theme_js}</script>
</head><body class="page-code">
<button class="theme-toggle" onclick="toggleTheme()"></button>
<div class="pathbar"><a href="/" class="home"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</div>
<div class="meta-row">{line_count} lines · {size_str} · .{ext}</div>
<div class="code-wrap"><pre>{code_html}</pre></div>
{chat_widget}</body></html>"#,
        relative = relative,
        css_base = STYLE_CSS,
        css_page = CODE_CSS,
        theme_js = THEME_JS,
        breadcrumb = breadcrumb,
        line_count = line_count,
        size_str = size_str,
        ext = ext,
        code_html = code_html,
        chat_widget = chat_widget,
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

/// GET /api/files — 根目录文件列表 JSON
async fn handle_files_api_root(
    State(state): State<Arc<ApiState>>,
) -> Response {
    handle_files_json(&state.cwd, "").await
}

/// GET /api/files/*path — 文件/目录信息 JSON
async fn handle_files_api(
    State(state): State<Arc<ApiState>>,
    Path(path): Path<String>,
) -> Response {
    handle_files_json(&state.cwd, &path).await
}

async fn handle_files_json(root: &PathBuf, relative: &str) -> Response {
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
                if name.starts_with('.') { continue; }
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

    let path_str = file_path.to_string_lossy().to_string();
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

    // SSE stream — 同时监听 ACP 流和 web_send_file 事件
    let mut file_rx = web_file_sender().subscribe();
    let target_session = chat_id.clone();
    let stream = async_stream::stream! {
        let mut rx = rx;
        loop {
            tokio::select! {
                biased;
                event = rx.recv() => {
                    match event {
                        Some(StreamEvent::Text(t)) => {
                            let data = serde_json::json!({"type": "text", "content": t});
                            yield Ok::<_, std::convert::Infallible>(format!("data: {}\n\n", data));
                        }
                        Some(StreamEvent::ToolCall(t)) => {
                            let data = serde_json::json!({"type": "tool", "content": t});
                            yield Ok::<_, std::convert::Infallible>(format!("data: {}\n\n", data));
                        }
                        None => {
                            // ACP 流结束
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
