//! 聊天浮窗组件 HTML/JS/CSS
//!
//! 使用 contenteditable div 支持图文混排输入。

/// 聊天浮窗的完整 HTML/CSS/JS 代码片段
pub const CHAT_WIDGET: &str = r##"
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
<style>
#chat-fab{position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:14px;background:var(--accent,#4f46e5);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(79,70,229,.35),0 1px 3px rgba(0,0,0,.1);z-index:9999;transition:all .25s cubic-bezier(.4,0,.2,1);}
#chat-fab:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(79,70,229,.4),0 2px 6px rgba(0,0,0,.1)}
#chat-fab:active{transform:translateY(0) scale(.94)}
#chat-panel{position:fixed;bottom:86px;right:24px;width:400px;max-width:calc(100vw - 48px);height:540px;max-height:calc(100vh - 120px);background:var(--card-bg,#1a1a1a);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:16px;box-shadow:0 24px 48px rgba(0,0,0,.12),0 4px 12px rgba(0,0,0,.06);z-index:9998;display:flex;flex-direction:column;overflow:hidden;animation:chatSlideIn .3s cubic-bezier(.4,0,.2,1);}
@keyframes chatSlideIn{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
#chat-header{padding:16px 20px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));display:flex;justify-content:space-between;align-items:center;}
#chat-header-left{display:flex;align-items:center;gap:10px;font-weight:600;font-size:.88em;letter-spacing:-.01em;}
#chat-avatar{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--accent,#4f46e5),var(--accent-light,#818cf8));display:flex;align-items:center;justify-content:center;color:#fff;}
#chat-header button:hover{background:var(--hover-bg);color:var(--fg)}
#chat-messages{flex:1;overflow-y:auto;padding:16px 16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}
#chat-messages::-webkit-scrollbar{width:4px;}
#chat-messages::-webkit-scrollbar-track{background:transparent;}
#chat-messages::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px;}
.msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:.86em;line-height:1.6;word-break:break-word;animation:msgIn .25s cubic-bezier(.4,0,.2,1);}
@keyframes msgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.msg-user{align-self:flex-end;background:var(--accent,#4f46e5);color:#fff;border-bottom-right-radius:4px;}
.msg-user img{max-width:200px;border-radius:8px;margin:4px 0;display:block;}
.msg-bot{align-self:flex-start;background:var(--hover-bg,rgba(99,102,241,.08));border-bottom-left-radius:4px;color:var(--fg);border-left:3px solid var(--accent,#6366f1);}
.msg-bot code{background:var(--code-bg,#141414);padding:1px 5px;border-radius:4px;font-size:.84em;font-family:'SF Mono','JetBrains Mono',monospace;}
.msg-bot pre{background:var(--code-bg,#141414);padding:12px 14px;border-radius:8px;overflow-x:auto;margin:8px 0;border:1px solid var(--border);}
.msg-typing{color:var(--muted)}
.msg-typing::after{content:'...';animation:dots 1.2s infinite;}
@keyframes dots{0%{content:'.'} 33%{content:'..'} 66%{content:'...'}}
.msg img{max-width:100%;border-radius:8px;margin:4px 0;}
#chat-input-area{border-top:1px solid var(--border,rgba(255,255,255,.08));padding:12px 14px;background:var(--bg,#0f0f0f);}
#chat-input-row{display:flex;gap:8px;align-items:flex-end;}
#chat-input{flex:1;min-height:38px;max-height:150px;overflow-y:auto;border:1px solid var(--border,rgba(255,255,255,.08));border-radius:12px;padding:9px 14px;background:var(--card-bg,#1a1a1a);color:var(--fg,#e4e4e7);font-size:.86em;line-height:1.55;outline:none;transition:all .2s cubic-bezier(.4,0,.2,1);word-break:break-word;}
#chat-input:focus{border-color:var(--accent,#4f46e5);box-shadow:0 0 0 3px rgba(99,102,241,.12);}
#chat-input:empty::before{content:attr(data-placeholder);color:var(--muted,#8b8b8b);pointer-events:none;}
#chat-input img{max-width:120px;max-height:80px;border-radius:8px;margin:2px;vertical-align:middle;cursor:default;}
#chat-input .file-tag{display:inline-block;background:var(--hover-bg,rgba(99,102,241,.08));border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:.78em;color:var(--muted);margin:2px;vertical-align:middle;}
#chat-send{width:36px;height:36px;border-radius:10px;border:none;background:var(--accent,#4f46e5);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s cubic-bezier(.4,0,.2,1);}
#chat-send:hover{transform:scale(1.05);box-shadow:0 2px 8px rgba(79,70,229,.3)}
#chat-send:active{transform:scale(.94)}
#chat-send:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
#chat-attach{width:36px;height:36px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.08));background:var(--card-bg,#1a1a1a);color:var(--muted,#8b8b8b);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s cubic-bezier(.4,0,.2,1);}
#chat-attach:hover{border-color:var(--accent);color:var(--accent);transform:scale(1.05)}
#chat-attach:active{transform:scale(.94)}
@media(max-width:500px){#chat-fab{bottom:20px;right:20px;width:48px;height:48px;border-radius:12px;}#chat-panel{bottom:0;right:0;width:100vw;height:100dvh;max-height:100dvh;border-radius:0;animation:none;border:none;}#chat-header{padding:14px 16px;padding-top:max(14px,env(safe-area-inset-top));}#chat-input-area{padding:10px 12px;padding-bottom:max(10px,env(safe-area-inset-bottom));}#chat-input{font-size:.9em;min-height:40px;padding:10px 14px;}#chat-send,#chat-attach{width:40px;height:40px;}.msg{max-width:88%;font-size:.88em;}}
@media(min-width:501px) and (max-width:768px){#chat-panel{width:360px;height:480px;bottom:80px;right:16px;}}
@media(min-width:1200px){#chat-panel{width:420px;height:580px;}}
</style>
<script>
window.copyCode=function(id){
  var el=document.getElementById(id);
  if(!el)return;
  var text=el.textContent||el.innerText;
  var btn=el.closest('div').querySelector('button');
  var copyIcon='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  var checkIcon='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  function done(){if(btn){btn.innerHTML=checkIcon;setTimeout(function(){btn.innerHTML=copyIcon;},1500);}}
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(done);
  } else {
    var ta=document.createElement('textarea');
    ta.value=text;
    ta.style.position='fixed';ta.style.left='-9999px';
    document.body.appendChild(ta);
    ta.select();
    try{document.execCommand('copy');done();}catch(e){}
    document.body.removeChild(ta);
  }
};
(function(){
  var messages=null;
  var sessionKey='chat-session-'+location.pathname;
  var historyKey='chat-history-'+location.pathname;

  window.toggleChat=function(){
    var panel=document.getElementById('chat-panel');
    var fab=document.getElementById('chat-fab');
    if(panel.style.display==='none'){
      panel.style.display='flex';
      fab.style.display='none';
      loadHistory();
      document.getElementById('chat-input').focus();
    }else{
      panel.style.display='none';
      fab.style.display='flex';
    }
  };

  function loadHistory(){
    messages=document.getElementById('chat-messages');
    var hist=JSON.parse(localStorage.getItem(historyKey)||'[]');
    messages.innerHTML='';
    hist.forEach(function(m){addMsgEl(m.role,'',m.html);});
    messages.scrollTop=messages.scrollHeight;
  }

  function saveHistory(){
    var msgs=document.querySelectorAll('#chat-messages .msg');
    var hist=[];
    msgs.forEach(function(el){
      // 存储时把大图片 src 替换为占位符，避免 localStorage 超限
      var html=el.innerHTML.replace(/src="data:[^"]{100,}"/g,'src="[image]"');
      hist.push({role:el.classList.contains('msg-user')?'user':'bot',html:html});
    });
    if(hist.length>30)hist=hist.slice(-30);
    try{localStorage.setItem(historyKey,JSON.stringify(hist));}catch(e){}
  }

  function addMsgEl(role,text,html){
    messages=messages||document.getElementById('chat-messages');
    var div=document.createElement('div');
    div.className='msg msg-'+role;
    if(html)div.innerHTML=html; else div.textContent=text;
    messages.appendChild(div);
    messages.scrollTop=messages.scrollHeight;
    return div;
  }

  // 从 contenteditable div 提取有序 blocks
  function extractBlocks(){
    var el=document.getElementById('chat-input');
    var blocks=[];
    var currentText='';

    function flushText(){
      var t=currentText.trim();
      if(t)blocks.push({type:'text',content:t});
      currentText='';
    }

    function walk(node){
      if(node.nodeType===3){
        currentText+=node.textContent;
      } else if(node.nodeName==='IMG'){
        flushText();
        var path=node.getAttribute('data-path')||'';
        if(path){
          blocks.push({type:'image',data:path});
        }
      } else if(node.nodeName==='BR'){
        currentText+='\n';
      } else if(node.classList&&node.classList.contains('file-tag')){
        flushText();
        var fname=node.getAttribute('data-name')||'file';
        var fpath=node.getAttribute('data-path')||'';
        if(fpath)blocks.push({type:'file',name:fname,data:fpath});
      } else if(node.nodeName==='DIV'||node.nodeName==='P'){
        if(currentText&&!currentText.endsWith('\n'))currentText+='\n';
        for(var i=0;i<node.childNodes.length;i++)walk(node.childNodes[i]);
        if(!currentText.endsWith('\n'))currentText+='\n';
      } else {
        for(var i=0;i<node.childNodes.length;i++)walk(node.childNodes[i]);
      }
    }

    for(var i=0;i<el.childNodes.length;i++)walk(el.childNodes[i]);
    flushText();
    return blocks;
  }

  window.sendMessage=function(){
    var el=document.getElementById('chat-input');
    var blocks=extractBlocks();
    if(blocks.length===0)return;

    // 显示用户消息（保留输入框的 HTML）
    addMsgEl('user','',el.innerHTML);
    el.innerHTML='';

    // typing
    var botEl=addMsgEl('bot','','<span class="msg-typing">思考中</span>');

    // 请求
    var body={blocks:blocks,session:localStorage.getItem(sessionKey)||'web-'+Math.random().toString(36).substr(2,8),context_path:location.pathname};
    if(!localStorage.getItem(sessionKey))localStorage.setItem(sessionKey,body.session);

    fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(resp){
      var reader=resp.body.getReader();
      var decoder=new TextDecoder();
      var fullText='';
      var phase='thinking'; // thinking | streaming | done
      var toolHint='';
      var buf=''; // SSE 数据可能跨 chunk 分割，需要缓冲
      function render(){
        if(phase==='thinking'){
          botEl.innerHTML='<span class="msg-typing">思考中</span>';
        } else {
          var md=fullText.trim()?renderMd(fullText):'';
          if(toolHint){
            md+='<div style="color:var(--muted);font-size:.8em;margin-top:4px">\u23f3 '+escHtml(toolHint)+'</div>';
          }
          botEl.innerHTML=md||'<span class="msg-typing">思考中</span>';
        }
        messages.scrollTop=messages.scrollHeight;
      }
      function processLine(line){
        if(!line.startsWith('data: '))return;
        var json=line.slice(6);
        if(!json)return;
        try{
          var ev=JSON.parse(json);
          if(ev.type==='text'&&ev.content){
            phase='streaming';
            toolHint='';
            fullText+=ev.content;
          } else if(ev.type==='tool'){
            if(phase==='thinking')phase='streaming';
            toolHint=ev.content||'';
          } else if(ev.type==='file'){
            phase='streaming';
            toolHint='';
            if(ev.is_image){
              fullText+='\n!['+ev.name+']('+ev.url+')\n';
            } else {
              fullText+='\n[\u{1f4ce} '+ev.name+']('+ev.url+')\n';
            }
          } else if(ev.type==='done'){
            phase='done';
            toolHint='';
          }
        }catch(e){}
      }
      function read(){
        reader.read().then(function(r){
          if(r.done){
            phase='done';toolHint='';
            if(!fullText.trim())botEl.innerHTML='<em style="color:var(--muted)">(无响应)</em>';
            else render();
            saveHistory();return;
          }
          buf+=decoder.decode(r.value,{stream:true});
          // 按换行拆分，保留最后不完整的一行
          var lines=buf.split('\n');
          buf=lines.pop()||'';
          for(var i=0;i<lines.length;i++){
            processLine(lines[i]);
          }
          render();
          read();
        }).catch(function(e){
          botEl.textContent='连接断开: '+e.message;
          saveHistory();
        });
      }
      read();
    }).catch(function(e){botEl.textContent='请求失败: '+e.message;saveHistory();});
  };

  function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function renderMd(text){
    if(!text)return '';
    var lines=text.split('\n');
    var html='';
    var inCode=false;
    var codeLang='';
    var codeLines=[];
    var inList=false;
    var listType='';

    for(var i=0;i<lines.length;i++){
      var line=lines[i];

      // 代码块开始/结束
      if(line.match(/^```/)){
        if(!inCode){
          if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
          inCode=true;
          codeLang=line.slice(3).trim();
          codeLines=[];
        } else {
          var codeId='code-'+Math.random().toString(36).substr(2,6);
          html+='<div style="position:relative;margin:6px 0"><pre style="background:var(--code-bg,#1e1e1e);padding:10px 12px;border-radius:6px;overflow-x:auto;margin:0"><code id="'+codeId+'">'+escHtml(codeLines.join('\n'))+'</code></pre><button onclick="copyCode(\''+codeId+'\')" style="position:absolute;top:6px;right:6px;background:var(--hover-bg,#323238);border:1px solid var(--border,#3f3f46);border-radius:4px;color:var(--muted,#a1a1aa);padding:4px;cursor:pointer;transition:all .15s;line-height:0" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div>';
          inCode=false;
          codeLines=[];
        }
        continue;
      }
      if(inCode){
        codeLines.push(line);
        continue;
      }

      // 标题
      var hm=line.match(/^(#{1,6})\s+(.+)$/);
      if(hm){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        var lvl=hm[1].length;
        html+='<h'+lvl+' style="margin:0.5em 0 0.3em;font-size:'+(1.3-lvl*0.1)+'em;font-weight:600">'+inlineFmt(hm[2])+'</h'+lvl+'>';
        continue;
      }

      // 无序列表
      var ulm=line.match(/^(\s*)[-*+]\s+(.+)$/);
      if(ulm){
        if(!inList||listType!=='ul'){if(inList)html+=listType==='ul'?'</ul>':'</ol>';html+='<ul style="margin:4px 0;padding-left:1.2em">';inList=true;listType='ul';}
        html+='<li>'+inlineFmt(ulm[2])+'</li>';
        continue;
      }

      // 有序列表
      var olm=line.match(/^(\s*)\d+[.)]\s+(.+)$/);
      if(olm){
        if(!inList||listType!=='ol'){if(inList)html+=listType==='ul'?'</ul>':'</ol>';html+='<ol style="margin:4px 0;padding-left:1.2em">';inList=true;listType='ol';}
        html+='<li>'+inlineFmt(olm[2])+'</li>';
        continue;
      }

      // 引用
      var bq=line.match(/^>\s?(.*)$/);
      if(bq){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        html+='<blockquote style="border-left:3px solid var(--accent-light,#818cf8);padding:2px 10px;margin:4px 0;color:var(--muted,#a1a1aa)">'+inlineFmt(bq[1])+'</blockquote>';
        continue;
      }

      // 表格：检测 | 开头的行
      if(line.trim().charAt(0)==='|'&&line.trim().slice(-1)==='|'){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        // 收集连续的表格行
        var tableLines=[line];
        while(i+1<lines.length){
          var next=lines[i+1].trim();
          if(next.charAt(0)==='|'&&next.slice(-1)==='|'){
            tableLines.push(lines[++i]);
          } else break;
        }
        html+=renderTable(tableLines);
        continue;
      }

      // 分割线
      if(/^[-*_]{3,}\s*$/.test(line)){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        html+='<hr style="border:none;border-top:1px solid var(--border,#3f3f46);margin:8px 0">';
        continue;
      }

      // 空行
      if(line.trim()===''){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        html+='<br>';
        continue;
      }

      // 普通段落
      if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
      html+='<p style="margin:0.2em 0">'+inlineFmt(line)+'</p>';
    }

    if(inList)html+=listType==='ul'?'</ul>':'</ol>';
    // 未闭合的代码块：显示为代码块（流式中间状态）
    if(inCode&&codeLines.length>0){
      var codeId='code-'+Math.random().toString(36).substr(2,6);
      html+='<div style="position:relative;margin:6px 0"><pre style="background:var(--code-bg,#1e1e1e);padding:10px 12px;border-radius:6px;overflow-x:auto;margin:0"><code id="'+codeId+'">'+escHtml(codeLines.join('\n'))+'</code></pre><button onclick="copyCode(\''+codeId+'\')" style="position:absolute;top:6px;right:6px;background:var(--hover-bg,#323238);border:1px solid var(--border,#3f3f46);border-radius:4px;color:var(--muted,#a1a1aa);padding:4px;cursor:pointer;transition:all .15s;line-height:0" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div>';
    }
    return html;
  }

  function inlineFmt(s){
    s=escHtml(s);
    // 行内代码（优先处理，内部不再进行格式化）
    s=s.replace(/`([^`]+)`/g,function(_,c){return '<code style="background:var(--code-bg,#1e1e1e);padding:1px 5px;border-radius:3px;font-size:.85em">'+c+'</code>';});
    // 粗体
    s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    // 斜体
    s=s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,'<em>$1</em>');
    // 删除线
    s=s.replace(/~~(.+?)~~/g,'<del>$1</del>');
    // 图片
    s=s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:4px 0;display:block">');
    // 链接
    s=s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" style="color:var(--link,#93c5fd)">$1</a>');
    return s;
  }

  function renderTable(tableLines){
    var rows=[];
    var alignRow=-1;
    for(var i=0;i<tableLines.length;i++){
      var cells=tableLines[i].trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(c){return c.trim();});
      var isAlign=cells.every(function(c){return /^:?-{2,}:?$/.test(c);});
      if(isAlign){alignRow=i;continue;}
      rows.push(cells);
    }
    if(rows.length===0)return '';
    var hasHeader=alignRow===1||(rows.length>1&&alignRow===-1);
    var t='<div style="overflow-x:auto;margin:8px 0;border-radius:6px;border:1px solid var(--border,#3f3f46)">';
    t+='<table style="border-collapse:collapse;min-width:100%;white-space:nowrap;font-size:.82em">';
    for(var r=0;r<rows.length;r++){
      var isHead=hasHeader&&r===0;
      t+='<tr>';
      for(var c=0;c<rows[r].length;c++){
        var tag=isHead?'th':'td';
        var style='padding:6px 12px;border-bottom:1px solid var(--border,#3f3f46);text-align:left;'+(isHead?'background:var(--hover-bg,#323238);font-weight:600;':'')+(c>0?'border-left:1px solid var(--border,#3f3f46);':'');
        t+='<'+tag+' style="'+style+'">'+inlineFmt(rows[r][c])+'</'+tag+'>';
      }
      t+='</tr>';
    }
    t+='</table></div>';
    return t;
  }

  // Enter 发送，Shift+Enter 换行
  document.addEventListener('keydown',function(e){
    if(e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });

  // 粘贴：图片直接上传后插入编辑区；非图片内容强制纯文本
  document.addEventListener('paste',function(e){
    var el=document.getElementById('chat-input');
    if(document.activeElement!==el)return;
    var items=e.clipboardData&&e.clipboardData.items;
    if(!items)return;
    // 优先检查是否有图片
    for(var i=0;i<items.length;i++){
      if(items[i].type.indexOf('image')!==-1){
        e.preventDefault();
        var file=items[i].getAsFile();
        uploadAndInsert(file,el,true);
        return;
      }
    }
    // 非图片粘贴：强制纯文本，去除富文本格式
    var text=e.clipboardData.getData('text/plain');
    if(text){
      e.preventDefault();
      // 用 insertText 命令插入纯文本，保留 undo 栈
      document.execCommand('insertText',false,text);
    }
  });

  // 拖拽文件
  document.addEventListener('dragover',function(e){
    if(document.getElementById('chat-panel').style.display==='none')return;
    e.preventDefault();
    e.dataTransfer.dropEffect='copy';
  });
  document.addEventListener('drop',function(e){
    if(document.getElementById('chat-panel').style.display==='none')return;
    e.preventDefault();
    var files=e.dataTransfer.files;
    if(files&&files.length>0)handleFiles(files);
  });

  // 通过按钮或拖拽选择文件 → 上传后插入
  window.handleFiles=function(files){
    var el=document.getElementById('chat-input');
    el.focus();
    for(var i=0;i<files.length;i++){
      uploadAndInsert(files[i],el,false);
    }
  };

  // 上传文件到服务端，先显示占位再替换
  // atCursor: true=插入到光标位置, false=追加到末尾
  function uploadAndInsert(file,el,atCursor){
    var isImg=file.type.startsWith('image/');
    var id='up-'+Math.random().toString(36).substr(2,8);

    // 用 execCommand 插入占位 HTML（保留 undo 栈）
    if(isImg){
      // 先读取本地预览
      var pr=new FileReader();
      pr.onload=function(ev){
        var html='<img id="'+id+'" src="'+ev.target.result+'" style="max-width:120px;max-height:80px;border-radius:6px;opacity:.5;vertical-align:middle;margin:2px" data-uploading="1">';
        el.focus();
        document.execCommand('insertHTML',false,html);
      };
      pr.readAsDataURL(file);
    } else {
      var html='<span id="'+id+'" class="file-tag" contenteditable="false" style="opacity:.6" data-uploading="1">\u23f3 '+file.name+'</span>&nbsp;';
      el.focus();
      document.execCommand('insertHTML',false,html);
    }

    // 上传
    fetch('/api/upload',{
      method:'POST',
      headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},
      body:file
    }).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function(resp){
      var node=document.getElementById(id);
      if(!node)return;
      node.removeAttribute('id');
      node.removeAttribute('data-uploading');
      if(isImg){
        node.style.opacity='1';
        node.setAttribute('data-path',resp.path);
      } else {
        node.textContent='\u{1f4ce} '+resp.name;
        node.style.opacity='1';
        node.setAttribute('data-name',resp.name);
        node.setAttribute('data-path',resp.path);
      }
    }).catch(function(e){
      var node=document.getElementById(id);
      if(!node)return;
      node.removeAttribute('data-uploading');
      if(isImg){node.style.opacity='1';node.style.border='2px solid red';}
      else{node.textContent='\u274c '+file.name;node.style.opacity='1';}
      console.error('上传失败:',e);
    });
  }
})();
</script>
"##;
