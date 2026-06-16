//! 聊天浮窗组件 HTML/JS/CSS
//!
//! 使用 contenteditable div 支持图文混排输入。
//! CSS 和 JS 从外部文件编译时嵌入。

/// 编译时嵌入的聊天组件静态资源
const CHAT_CSS: &str = include_str!("web/static/chat.css");
const CHAT_JS: &str = include_str!("web/static/chat.js");

/// 聊天浮窗的 HTML 结构
const CHAT_HTML: &str = r#"
<div id="chat-fab" onclick="toggleChat()">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
</div>
<div id="chat-panel" style="display:none">
  <div id="chat-header">
    <div id="chat-header-left">
      <div id="chat-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a4 4 0 014 4v2a4 4 0 01-8 0V6a4 4 0 014-4z"/><path d="M18 14a6 6 0 00-12 0v4h12v-4z"/></svg></div>
      <span>AI 助手</span>
    </div>
    <button onclick="toggleChat()" aria-label="关闭" style="background:none;border:none;color:var(--muted);width:28px;height:28px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>
  <div id="chat-messages"></div>
  <div id="chat-input-area">
    <div id="chat-input-row">
      <label id="chat-attach" title="添加附件"><input type="file" multiple style="display:none" onchange="handleFiles(this.files);this.value=''"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg></label>
      <div id="chat-input" contenteditable="true" data-placeholder="输入消息，粘贴图片或拖拽文件"></div>
      <button id="chat-send" onclick="sendMessage()" aria-label="发送">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</div>
"#;

/// 获取完整的聊天浮窗 HTML（含 CSS 和 JS），返回 &'static str
pub fn chat_widget() -> &'static str {
    use std::sync::OnceLock;
    static WIDGET: OnceLock<String> = OnceLock::new();
    let s = WIDGET.get_or_init(|| {
        format!("{CHAT_HTML}\n<style>\n{CHAT_CSS}\n</style>\n<script>\n{CHAT_JS}\n</script>")
    });
    s.as_str()
}
