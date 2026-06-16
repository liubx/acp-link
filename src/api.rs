//! HTTP API — `/api/ask` SSE 流式问答端点
//!
//! 提供 HTTP 接口直接与 agent 对话，返回 SSE 流。
//! 复用 AcpBridge 进程池和 session 管理。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::post;
use tokio::sync::{RwLock, broadcast};

use crate::link::{AcpBridge, StreamEvent};
use crate::chat::CHAT_WIDGET;
use base64::Engine;

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
            Ok(serve_notes_file(&root, &path).await)
        })
    }
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

    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>/{relative}</title>
{THEME_HEAD}
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{max-width:680px;margin:0 auto;padding:80px 24px 100px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC','Inter',system-ui,sans-serif;min-height:100dvh;-webkit-font-smoothing:antialiased;letter-spacing:-.01em;}}
h2{{font-size:.82em;font-weight:500;color:var(--muted);margin:0;padding:14px 24px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);letter-spacing:.01em;}}
h2 a{{color:var(--muted);text-decoration:none;transition:all .2s cubic-bezier(.4,0,.2,1);}}
h2 a:hover{{color:var(--accent-light)}}
h2 a.home{{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--hover-bg);color:var(--muted);transition:all .2s cubic-bezier(.4,0,.2,1);}}
h2 a.home:hover{{background:var(--accent);color:#fff;transform:scale(1.05)}}
h2 a.home svg{{display:block}}
h2 .sep{{color:var(--muted);opacity:.4;font-weight:300;font-size:.9em;margin:0 2px;}}
h2 .current{{color:var(--fg);font-weight:600}}
.list{{border-radius:14px;overflow:hidden;background:var(--card-bg);border:1px solid var(--border);box-shadow:var(--shadow);}}
.entry{{display:block;padding:13px 24px 13px 28px;border-bottom:1px solid var(--border);position:relative;overflow:hidden;transition:all .2s cubic-bezier(.4,0,.2,1);}}
.entry:last-child{{border-bottom:none}}
.entry::before{{content:'';position:absolute;left:12px;top:50%;transform:translateY(-50%);width:3px;height:20px;border-radius:2px;background:var(--border);transition:all .2s cubic-bezier(.4,0,.2,1);}}
.dir::before{{background:#f59e0b;}}
.md::before{{background:var(--accent);}}
.file::before{{background:var(--muted);opacity:.4;}}
.entry:hover{{background:var(--hover-bg)}}
.entry:hover::before{{height:28px;}}
.entry:active{{transform:scale(.995)}}
.entry a{{text-decoration:none;color:var(--fg);font-size:.88em;font-weight:400;display:flex;align-items:center;gap:12px;transition:color .15s;}}
.entry:hover a{{color:var(--accent-light)}}
.dir a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'%3E%3Cpath d='M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:.85;}}
.md a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236366f1'%3E%3Cpath d='M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6zm7 1.5L18.5 9H14a1 1 0 01-1-1V3.5zM8 13h8v1.5H8V13zm0 3.5h5V18H8v-1.5z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:.85;}}
.file a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239ca3af'%3E%3Cpath d='M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6zm7 1.5L18.5 9H14a1 1 0 01-1-1V3.5z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:.7;}}
.config a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2310b981'%3E%3Cpath d='M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6zm7 1.5L18.5 9H14a1 1 0 01-1-1V3.5zM8 13h8v1.5H8V13zm0 3h6v1.5H8V16z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:.85;}}
.code a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f472b6'%3E%3Cpath d='M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6zm7 1.5L18.5 9H14a1 1 0 01-1-1V3.5zM9.4 12.6l-2.4 2.4 2.4 2.4-.8.8L5.4 15l3.2-3.2.8.8zm5.2 0l2.4 2.4-2.4 2.4.8.8 3.2-3.2-3.2-3.2-.8.8z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:.85;}}
.image a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%238b5cf6'%3E%3Cpath d='M4 4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2H4zm0 2h16v8.6l-3.3-3.3a1 1 0 00-1.4 0L10 16.6l-2.3-2.3a1 1 0 00-1.4 0L4 16.6V6zm4 2a2 2 0 100 4 2 2 0 000-4z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:.85;}}
.config::before{{background:#10b981 !important;}}
.code::before{{background:#f472b6 !important;}}
.image::before{{background:#8b5cf6 !important;}}
.dir a{{font-weight:500}}
.dir a::after{{content:'';display:inline-block;width:14px;height:14px;margin-left:auto;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:0;transform:translateX(-6px);transition:all .2s cubic-bezier(.4,0,.2,1);}}
.entry:hover .dir a::after,.dir:hover a::after{{opacity:.7;transform:translateX(0)}}
@media(max-width:600px){{body{{padding:48px 16px 80px}}.list{{border-radius:12px;}}.entry{{padding:14px 16px}}.entry a{{font-size:.87em;gap:10px}}h2{{padding:12px 16px;font-size:.8em;}}}}
@media(min-width:1024px){{body{{max-width:720px;padding:100px 32px 120px;}}}}
</style></head><body>
<button class="theme-toggle" onclick="toggleTheme()"></button>
<div class="list">
<h2><a href="/" class="home" title="根目录"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</h2>
{items_html}
</div>{CHAT_WIDGET}</body></html>"#
    );

    Html(html)
}

/// 公共主题切换 CSS 变量 + JS（目录页和 markdown 页共用）
const THEME_HEAD: &str = r#"<style>
:root{--bg:#fafafa;--fg:#1a1a1a;--muted:#6b7280;--border:rgba(0,0,0,.08);--card-bg:#ffffff;--link:#2563eb;--hover-bg:rgba(99,102,241,.04);--accent:#4f46e5;--accent-light:#6366f1;--code-bg:#f1f5f9;--shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);}
@media(prefers-color-scheme:dark){:root{--bg:#0f0f0f;--fg:#e4e4e7;--muted:#8b8b8b;--border:rgba(255,255,255,.08);--card-bg:#1a1a1a;--link:#93c5fd;--hover-bg:rgba(99,102,241,.08);--accent:#6366f1;--accent-light:#818cf8;--code-bg:#141414;--shadow:0 1px 3px rgba(0,0,0,.2),0 8px 24px rgba(0,0,0,.3);}}
html[data-theme=light]{--bg:#fafafa;--fg:#1a1a1a;--muted:#6b7280;--border:rgba(0,0,0,.08);--card-bg:#ffffff;--link:#2563eb;--hover-bg:rgba(99,102,241,.04);--accent:#4f46e5;--accent-light:#6366f1;--code-bg:#f1f5f9;--shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);}
html[data-theme=dark]{--bg:#0f0f0f;--fg:#e4e4e7;--muted:#8b8b8b;--border:rgba(255,255,255,.08);--card-bg:#1a1a1a;--link:#93c5fd;--hover-bg:rgba(99,102,241,.08);--accent:#6366f1;--accent-light:#818cf8;--code-bg:#141414;--shadow:0 1px 3px rgba(0,0,0,.2),0 8px 24px rgba(0,0,0,.3);}
body{background:var(--bg);color:var(--fg);transition:background .3s cubic-bezier(.4,0,.2,1),color .3s cubic-bezier(.4,0,.2,1);}
.theme-toggle{position:fixed;top:20px;right:20px;width:38px;height:38px;border-radius:10px;border:1px solid var(--border);background:var(--card-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;z-index:999;transition:all .2s cubic-bezier(.4,0,.2,1);box-shadow:var(--shadow);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}
.theme-toggle:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(79,70,229,.15);border-color:var(--accent-light);}
.theme-toggle:active{transform:translateY(0) scale(.96);}
</style>
<script>
(function(){
  var t=localStorage.getItem('theme');
  if(t&&t!=='auto')document.documentElement.setAttribute('data-theme',t);
})();
function toggleTheme(){
  var h=document.documentElement;
  var c=localStorage.getItem('theme')||'auto';
  var next=c==='auto'?'light':(c==='light'?'dark':'auto');
  if(next==='auto'){
    h.removeAttribute('data-theme');
    localStorage.setItem('theme','auto');
  }else{
    h.setAttribute('data-theme',next);
    localStorage.setItem('theme',next);
  }
  updateIcon();
}
function updateIcon(){
  var btn=document.querySelector('.theme-toggle');
  if(!btn)return;
  var t=localStorage.getItem('theme')||'auto';
  var sun='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var moon='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  var auto='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" stroke="currentColor"/><path d="M12 3a9 9 0 010 18" fill="currentColor" opacity=".2"/></svg>';
  btn.innerHTML=t==='dark'?sun:(t==='light'?moon:auto);
  btn.title=t==='dark'?'切换到跟随系统':(t==='light'?'切换到深色':'切换到浅色');
}
document.addEventListener('DOMContentLoaded',updateIcon);
</script>"#;

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

    format!(r#"<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{relative}</title>
{THEME_HEAD}
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{max-width:860px;margin:0 auto;padding:80px 24px 100px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC','Inter',system-ui,sans-serif;min-height:100dvh;-webkit-font-smoothing:antialiased;line-height:1.75;letter-spacing:-.01em;}}
.nav{{background:var(--card-bg);border:1px solid var(--border);border-radius:14px 14px 0 0;display:flex;align-items:center;overflow:hidden;border-bottom:1px solid var(--border);}}
.nav-inner{{display:flex;align-items:center;gap:8px;font-size:.82em;padding:14px 24px;font-weight:500;color:var(--muted);letter-spacing:.01em;}}
.content{{background:var(--card-bg);border:1px solid var(--border);border-top:none;border-radius:0 0 14px 14px;padding:40px 36px;box-shadow:var(--shadow);}}
.nav a{{color:var(--muted);text-decoration:none;transition:color .2s cubic-bezier(.4,0,.2,1);}}
.nav a:hover{{color:var(--accent-light)}}
.nav a.home{{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--hover-bg);color:var(--muted);transition:all .2s cubic-bezier(.4,0,.2,1);}}
.nav a.home:hover{{background:var(--accent);color:#fff;transform:scale(1.05)}}
.nav .sep{{color:var(--muted);opacity:.4;font-weight:300;margin:0 2px;}}
.nav .current{{color:var(--fg);font-weight:600;}}
.content h1,.content h2,.content h3{{border-bottom:1px solid var(--border);padding-bottom:0.4em;margin-top:1.8em;margin-bottom:0.6em;letter-spacing:-.02em;}}
.content h1{{font-size:1.6em;font-weight:700;}}
.content h2{{font-size:1.3em;font-weight:650;}}
.content h3{{font-size:1.1em;font-weight:600;border-bottom:none;}}
.content h1:first-child,.content h2:first-child{{margin-top:0;}}
.content code{{background:var(--code-bg);padding:2px 7px;border-radius:5px;font-size:0.85em;font-family:'SF Mono','JetBrains Mono','Fira Code',monospace;}}
.content pre{{background:var(--code-bg);padding:18px 20px;border-radius:10px;overflow-x:auto;margin:1.2em 0;border:1px solid var(--border);position:relative;}}
.content pre::before{{content:'';position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:0 2px 2px 0;background:var(--accent);opacity:.5;}}
.content pre code{{background:none;padding:0;font-size:.84em;line-height:1.6;}}
.content table{{border-collapse:collapse;width:100%;margin:1.2em 0;border-radius:8px;overflow:hidden;border:1px solid var(--border);}}
.content th,.content td{{border:1px solid var(--border);padding:10px 14px;text-align:left;font-size:.9em;}}
.content th{{background:var(--hover-bg);font-weight:600;font-size:.84em;text-transform:none;letter-spacing:.01em;}}
.content blockquote{{border-left:3px solid var(--accent-light);margin:1.2em 0;padding:0.6em 20px;color:var(--muted);background:var(--hover-bg);border-radius:0 10px 10px 0;}}
.content img{{max-width:100%;border-radius:10px;margin:1.2em 0;}}
.content a{{color:var(--link);text-decoration:none;border-bottom:1px solid transparent;transition:border-color .2s;}}
.content a:hover{{border-bottom-color:var(--link)}}
.content ul,.content ol{{padding-left:1.5em;margin:0.6em 0;}}
.content li{{margin:0.35em 0;}}
.content li::marker{{color:var(--muted);}}
.content hr{{border:none;border-top:1px solid var(--border);margin:2.5em 0;}}
.content p{{margin:0.6em 0;}}
@media(max-width:600px){{body{{padding:48px 16px 80px}}.content{{padding:24px 18px;border-radius:0 0 12px 12px;}}.nav{{border-radius:12px 12px 0 0;}}.nav-inner{{padding:12px 16px;font-size:.8em;}}.content h1{{font-size:1.35em;}}.content h2{{font-size:1.15em;}}.content pre{{padding:14px 12px;font-size:.82em;border-radius:8px;}}.content table{{font-size:.84em;}}.content th,.content td{{padding:8px 10px;}}}}
@media(min-width:1024px){{body{{max-width:920px;padding:100px 40px 120px;}}.content{{padding:48px 44px;}}}}
</style></head><body>
<button class="theme-toggle" onclick="toggleTheme()"></button>
<div class="nav"><div class="nav-inner"><a href="/" class="home" title="根目录"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</div></div>
<div class="content">{html_output}</div>
{CHAT_WIDGET}</body></html>"#)
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

    // 使用 base16-ocean.dark 主题（与暗色 UI 搭配），浅色模式下通过 CSS 反色
    let theme = &ts.themes["base16-ocean.dark"];
    let highlighted = highlighted_html_for_string(content, &ss, syntax, theme)
        .unwrap_or_else(|_| format!("<pre><code>{}</code></pre>", content));

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

    format!(r#"<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{relative}</title>
{THEME_HEAD}
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{max-width:960px;margin:0 auto;padding:80px 24px 100px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC','Inter',system-ui,sans-serif;min-height:100dvh;-webkit-font-smoothing:antialiased;}}
.nav{{background:var(--card-bg);border:1px solid var(--border);border-radius:14px 14px 0 0;display:flex;align-items:center;justify-content:space-between;overflow:hidden;border-bottom:1px solid var(--border);}}
.nav-inner{{display:flex;align-items:center;gap:8px;font-size:.82em;padding:14px 24px;font-weight:500;color:var(--muted);letter-spacing:.01em;}}
.nav-meta{{font-size:.75em;color:var(--muted);padding:14px 24px;opacity:.7;}}
.code-wrap{{background:var(--code-bg);border:1px solid var(--border);border-top:none;border-radius:0 0 14px 14px;overflow:hidden;box-shadow:var(--shadow);}}
.code-wrap pre{{margin:0;padding:20px 24px;overflow-x:auto;font-family:'SF Mono','JetBrains Mono','Fira Code','Cascadia Code',monospace;font-size:.82em;line-height:1.7;tab-size:4;}}
.nav a{{color:var(--muted);text-decoration:none;transition:color .2s cubic-bezier(.4,0,.2,1);}}
.nav a:hover{{color:var(--accent-light)}}
.nav a.home{{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--hover-bg);color:var(--muted);transition:all .2s cubic-bezier(.4,0,.2,1);}}
.nav a.home:hover{{background:var(--accent);color:#fff;transform:scale(1.05)}}
.nav .sep{{color:var(--muted);opacity:.4;font-weight:300;margin:0 2px;}}
.nav .current{{color:var(--fg);font-weight:600;}}
@media(max-width:600px){{body{{padding:48px 16px 80px}}.code-wrap pre{{padding:14px 12px;font-size:.78em;}}.nav-inner{{padding:12px 16px;}}.nav-meta{{padding:12px 16px;}}}}
@media(min-width:1024px){{body{{max-width:1040px;padding:100px 40px 120px;}}}}
</style></head><body>
<button class="theme-toggle" onclick="toggleTheme()"></button>
<div class="nav"><div class="nav-inner"><a href="/" class="home" title="根目录"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</div><div class="nav-meta">{line_count} 行 · {size_str} · {ext}</div></div>
<div class="code-wrap">{highlighted}</div>
{CHAT_WIDGET}</body></html>"#)
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

/// POST /api/upload — 上传文件到 .tmp/upload/，返回服务端路径
async fn handle_upload(
    State(state): State<Arc<ApiState>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let upload_dir = state.cwd.join(".tmp/upload");
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
        let upload_dir = state.cwd.join(".tmp/upload");
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
            let upload_dir = state.cwd.join(".tmp/upload");
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
