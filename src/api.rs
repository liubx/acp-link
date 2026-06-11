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
        cwd: cwd.clone(),
        sessions: RwLock::new(HashMap::new()),
    });

    Router::new()
        .route("/api/ask", post(handle_ask))
        .with_state(state)
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
body{{max-width:660px;margin:0 auto;padding:60px 20px 80px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC',system-ui,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased;}}
h2{{font-size:.9em;font-weight:500;color:var(--muted);margin:0;padding:12px 20px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);}}
h2 a{{color:var(--muted);text-decoration:none;transition:all .15s;}}
h2 a:hover{{color:var(--accent-light)}}
h2 a.home{{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:var(--card-bg);border:1px solid var(--border);color:var(--muted);transition:all .15s;}}
h2 a.home:hover{{background:var(--accent);color:#fff}}
h2 a.home svg{{display:block}}
h2 .sep{{color:var(--border);font-weight:300;font-size:.9em}}
h2 .current{{color:var(--fg);font-weight:600}}
.list{{border-radius:16px;overflow:hidden;background:var(--card-bg);border:1px solid var(--border);box-shadow:0 20px 60px rgba(0,0,0,.1);}}
.entry{{display:block;padding:14px 20px;border-bottom:1px solid var(--border);position:relative;overflow:hidden;transition:background .15s;}}
.entry:last-child{{border-bottom:none}}
.entry:hover{{background:var(--hover-bg)}}
.entry::before{{content:'';position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(180deg,var(--accent-light),var(--accent));transition:width .2s cubic-bezier(.4,0,.2,1);border-radius:0 4px 4px 0;}}
.entry:hover::before{{width:4px}}
.entry a{{text-decoration:none;color:var(--fg);font-size:.9em;font-weight:400;display:flex;align-items:center;gap:12px;transition:color .12s;}}
.entry:hover a{{color:var(--accent-light)}}
.dir a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fbbf24'%3E%3Cpath d='M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z'/%3E%3C/svg%3E") center/contain no-repeat;}}
.md a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2360a5fa'%3E%3Cpath d='M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6zm7 1.5L18.5 9H14a1 1 0 01-1-1V3.5zM8 13h8v1.5H8V13zm0 3.5h5V18H8v-1.5z'/%3E%3C/svg%3E") center/contain no-repeat;}}
.file a::before{{content:'';display:inline-block;width:20px;height:20px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23a1a1aa'%3E%3Cpath d='M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6zm7 1.5L18.5 9H14a1 1 0 01-1-1V3.5z'/%3E%3C/svg%3E") center/contain no-repeat;}}
.dir a{{font-weight:500}}
.dir a::after{{content:'';display:inline-block;width:16px;height:16px;margin-left:auto;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2352525b'%3E%3Cpath fill-rule='evenodd' d='M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z'/%3E%3C/svg%3E") center/contain no-repeat;opacity:0;transform:translateX(-4px);transition:all .15s ease;}}
.entry:hover .dir a::after,.dir:hover a::after{{opacity:1;transform:translateX(0)}}
@media(max-width:600px){{body{{padding:32px 12px 60px}}.entry{{padding:12px 14px}}.entry a{{font-size:.85em;gap:10px}}}}
</style></head><body>
<button class="theme-toggle" onclick="toggleTheme()">🌙</button>
<div class="list">
<h2><a href="/" class="home" title="根目录"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</h2>
{items_html}
</div></body></html>"#
    );

    Html(html)
}

/// 公共主题切换 CSS 变量 + JS（目录页和 markdown 页共用）
const THEME_HEAD: &str = r#"<style>
:root{--bg:#ffffff;--fg:#24292f;--muted:#656d76;--border:#d1d5db;--card-bg:#f6f8fa;--link:#0969da;--hover-bg:#f3f4f6;--accent:#4f46e5;--accent-light:#818cf8;--code-bg:#f4f4f5;}
@media(prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#f4f4f5;--muted:#a1a1aa;--border:#3f3f46;--card-bg:#27272a;--hover-bg:#323238;--link:#93c5fd;--accent:#6366f1;--accent-light:#818cf8;--code-bg:#27272a;}}
html[data-theme=light]{--bg:#ffffff;--fg:#24292f;--muted:#656d76;--border:#d1d5db;--card-bg:#f6f8fa;--link:#0969da;--hover-bg:#f3f4f6;--accent:#4f46e5;--accent-light:#818cf8;--code-bg:#f4f4f5;}
html[data-theme=dark]{--bg:#18181b;--fg:#f4f4f5;--muted:#a1a1aa;--border:#3f3f46;--card-bg:#27272a;--hover-bg:#323238;--link:#93c5fd;--accent:#6366f1;--accent-light:#818cf8;--code-bg:#27272a;}
body{background:var(--bg);color:var(--fg);transition:background .2s,color .2s;}
.theme-toggle{position:fixed;top:16px;right:16px;width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:var(--card-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;z-index:999;transition:all .15s;box-shadow:0 2px 8px rgba(0,0,0,.1);}
.theme-toggle:hover{transform:scale(1.1);border-color:var(--accent);}
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
  var sun='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var moon='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  var auto='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" stroke="currentColor"/><path d="M12 3a9 9 0 010 18" fill="currentColor" opacity=".3"/></svg>';
  btn.innerHTML=t==='dark'?sun:(t==='light'?moon:auto);
  btn.title=t==='dark'?'切换到跟随系统':(t==='light'?'切换到深色':'切换到浅色');
}
document.addEventListener('DOMContentLoaded',updateIcon);
</script>"#;

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
body{{max-width:900px;margin:0 auto;padding:60px 20px 80px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC',system-ui,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.7;}}
.nav{{background:var(--card-bg);border:1px solid var(--border);border-radius:16px 16px 0 0;display:flex;align-items:center;overflow:hidden;border-bottom:1px solid var(--border);}}
.nav-inner{{display:flex;align-items:center;gap:8px;font-size:.85em;padding:12px 20px;font-weight:500;color:var(--muted);}}
.content{{background:var(--card-bg);border:1px solid var(--border);border-top:none;border-radius:0 0 16px 16px;padding:32px;}}
.nav a{{color:var(--muted);text-decoration:none;transition:color .15s;}}
.nav a:hover{{color:var(--accent-light)}}
.nav a.home{{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:var(--hover-bg);color:var(--muted);transition:all .15s;}}
.nav a.home:hover{{background:var(--accent);color:#fff}}
.nav .sep{{color:var(--border);font-weight:300;}}
.nav .current{{color:var(--fg);font-weight:600;}}
.content h1,.content h2,.content h3{{border-bottom:1px solid var(--border);padding-bottom:0.3em;margin-top:1.5em;margin-bottom:0.5em;}}
.content h1:first-child,.content h2:first-child{{margin-top:0;}}
.content code{{background:var(--code-bg);padding:2px 6px;border-radius:4px;font-size:0.88em;}}
.content pre{{background:var(--code-bg);padding:16px;border-radius:8px;overflow-x:auto;margin:1em 0;}}
.content pre code{{background:none;padding:0;}}
.content table{{border-collapse:collapse;width:100%;margin:1em 0;}}
.content th,.content td{{border:1px solid var(--border);padding:8px 12px;text-align:left;}}
.content th{{background:var(--hover-bg);font-weight:600;}}
.content blockquote{{border-left:4px solid var(--accent-light);margin:1em 0;padding:0.5em 16px;color:var(--muted);background:var(--hover-bg);border-radius:0 8px 8px 0;}}
.content img{{max-width:100%;border-radius:8px;margin:1em 0;}}
.content a{{color:var(--link);}}
.content ul,.content ol{{padding-left:1.5em;margin:0.5em 0;}}
.content li{{margin:0.3em 0;}}
.content hr{{border:none;border-top:1px solid var(--border);margin:2em 0;}}
@media(max-width:600px){{body{{padding:32px 12px 60px}}.content{{padding:20px 16px;}}}}
</style></head><body>
<button class="theme-toggle" onclick="toggleTheme()"></button>
<div class="nav"><div class="nav-inner"><a href="/" class="home" title="根目录"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/></svg></a>{breadcrumb}</div></div>
<div class="content">{html_output}</div>
</body></html>"#)
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
