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
    // 加载历史时禁用平滑滚动，直接跳到底部
    messages.style.scrollBehavior='auto';
    messages.innerHTML='';
    hist.forEach(function(m){addMsgEl(m.role,'',m.html);});
    // 用 requestAnimationFrame 确保 DOM 渲染完后再滚动
    requestAnimationFrame(function(){
      messages.scrollTop=messages.scrollHeight;
      // 恢复平滑滚动（用于后续新消息）
      setTimeout(function(){messages.style.scrollBehavior='smooth';},50);
    });
  }

  function saveHistory(){
    var msgs=document.querySelectorAll('#chat-messages .msg');
    var hist=[];
    msgs.forEach(function(el){
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

    addMsgEl('user','',el.innerHTML);
    el.innerHTML='';

    var botEl=addMsgEl('bot','','<span class="msg-typing">思考中</span>');

    var body={blocks:blocks,session:localStorage.getItem(sessionKey)||'web-'+Math.random().toString(36).substr(2,8),context_path:location.pathname};
    if(!localStorage.getItem(sessionKey))localStorage.setItem(sessionKey,body.session);

    fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(resp){
      var reader=resp.body.getReader();
      var decoder=new TextDecoder();
      var fullText='';
      var phase='thinking';
      var toolHint='';
      var buf='';
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

      var hm=line.match(/^(#{1,6})\s+(.+)$/);
      if(hm){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        var lvl=hm[1].length;
        html+='<h'+lvl+' style="margin:0.5em 0 0.3em;font-size:'+(1.3-lvl*0.1)+'em;font-weight:600">'+inlineFmt(hm[2])+'</h'+lvl+'>';
        continue;
      }

      var ulm=line.match(/^(\s*)[-*+]\s+(.+)$/);
      if(ulm){
        if(!inList||listType!=='ul'){if(inList)html+=listType==='ul'?'</ul>':'</ol>';html+='<ul style="margin:4px 0;padding-left:1.2em">';inList=true;listType='ul';}
        html+='<li>'+inlineFmt(ulm[2])+'</li>';
        continue;
      }

      var olm=line.match(/^(\s*)\d+[.)]\s+(.+)$/);
      if(olm){
        if(!inList||listType!=='ol'){if(inList)html+=listType==='ul'?'</ul>':'</ol>';html+='<ol style="margin:4px 0;padding-left:1.2em">';inList=true;listType='ol';}
        html+='<li>'+inlineFmt(olm[2])+'</li>';
        continue;
      }

      var bq=line.match(/^>\s?(.*)$/);
      if(bq){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        html+='<blockquote style="border-left:3px solid var(--accent-light,#818cf8);padding:2px 10px;margin:4px 0;color:var(--muted,#a1a1aa)">'+inlineFmt(bq[1])+'</blockquote>';
        continue;
      }

      if(line.trim().charAt(0)==='|'&&line.trim().slice(-1)==='|'){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
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

      if(/^[-*_]{3,}\s*$/.test(line)){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        html+='<hr style="border:none;border-top:1px solid var(--border,#3f3f46);margin:8px 0">';
        continue;
      }

      if(line.trim()===''){
        if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
        html+='<br>';
        continue;
      }

      if(inList){html+=listType==='ul'?'</ul>':'</ol>';inList=false;}
      html+='<p style="margin:0.2em 0">'+inlineFmt(line)+'</p>';
    }

    if(inList)html+=listType==='ul'?'</ul>':'</ol>';
    if(inCode&&codeLines.length>0){
      var codeId='code-'+Math.random().toString(36).substr(2,6);
      html+='<div style="position:relative;margin:6px 0"><pre style="background:var(--code-bg,#1e1e1e);padding:10px 12px;border-radius:6px;overflow-x:auto;margin:0"><code id="'+codeId+'">'+escHtml(codeLines.join('\n'))+'</code></pre><button onclick="copyCode(\''+codeId+'\')" style="position:absolute;top:6px;right:6px;background:var(--hover-bg,#323238);border:1px solid var(--border,#3f3f46);border-radius:4px;color:var(--muted,#a1a1aa);padding:4px;cursor:pointer;transition:all .15s;line-height:0" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div>';
    }
    return html;
  }

  function inlineFmt(s){
    s=escHtml(s);
    s=s.replace(/`([^`]+)`/g,function(_,c){return '<code style="background:var(--code-bg,#1e1e1e);padding:1px 5px;border-radius:3px;font-size:.85em">'+c+'</code>';});
    s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    s=s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,'<em>$1</em>');
    s=s.replace(/~~(.+?)~~/g,'<del>$1</del>');
    s=s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:4px 0;display:block">');
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

  document.addEventListener('keydown',function(e){
    if(e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });

  document.addEventListener('paste',function(e){
    var el=document.getElementById('chat-input');
    if(document.activeElement!==el)return;
    var items=e.clipboardData&&e.clipboardData.items;
    if(!items)return;
    for(var i=0;i<items.length;i++){
      if(items[i].type.indexOf('image')!==-1){
        e.preventDefault();
        var file=items[i].getAsFile();
        uploadAndInsert(file,el,true);
        return;
      }
    }
    var text=e.clipboardData.getData('text/plain');
    if(text){
      e.preventDefault();
      document.execCommand('insertText',false,text);
    }
  });

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

  window.handleFiles=function(files){
    var el=document.getElementById('chat-input');
    el.focus();
    for(var i=0;i<files.length;i++){
      uploadAndInsert(files[i],el,false);
    }
  };

  function uploadAndInsert(file,el,atCursor){
    var isImg=file.type.startsWith('image/');
    var id='up-'+Math.random().toString(36).substr(2,8);

    if(isImg){
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
