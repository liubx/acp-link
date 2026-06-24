import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { PaperPlaneRight, Paperclip, Stop, Copy, Check, Lock, LockOpen, Notebook, Sun, Moon, CircleHalf, MagnifyingGlass, UsersThree, User, ArrowClockwise } from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchModal } from './SearchModal'
import { Breadcrumb } from './Breadcrumb'

// --- 类型 ---
interface Attachment { name: string; path: string; type: 'image' | 'file' }
interface Message { role: 'user' | 'bot'; content: string; attachments?: Attachment[]; timestamp?: number; failed?: boolean }
interface ChatBlock { type: string; content: string; name?: string }

// --- 时间格式化：当天只显示时间，非当天显示日期+时间 ---
function formatMsgTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return time
  const date = `${d.getMonth() + 1}/${d.getDate()}`
  return `${date} ${time}`
}

// --- 代码块 ---
function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const lang = className?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')
  const lines = code.split('\n')

  const handleCopy = () => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
    } else {
      const ta = document.createElement('textarea'); ta.value = code; ta.style.position = 'fixed'; ta.style.left = '-9999px'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)] my-2">
      <div className="px-3 py-1.5 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-dim)] font-mono uppercase">{lang || 'code'}</span>
        <button onClick={handleCopy} className="text-[var(--color-muted)] hover:text-[var(--color-fg)] p-1 rounded hover:bg-[var(--color-border)] transition-colors cursor-pointer" aria-label="复制">
          {copied ? <Check size={12} weight="bold" className="text-green-500" /> : <Copy size={12} />}
        </button>
      </div>
      <div className="overflow-x-auto">
        <pre className="px-0 py-3 text-[12px] leading-relaxed font-mono">
          <code>{lines.map((line, i) => (
            <div key={i} className="flex hover:bg-[var(--color-bg)] transition-colors px-4">
              <span className="select-none text-[var(--color-dim)] text-right w-7 pr-3 flex-shrink-0">{i + 1}</span>
              <span className="text-[var(--color-fg)] flex-1">{line || ' '}</span>
            </div>
          ))}</code>
        </pre>
      </div>
    </div>
  )
}

// --- 用户消息 ---
function UserMessageContent({ content }: { content: string }) {
  const parts = useMemo(() => {
    if (!content) return []
    const result: { type: 'text' | 'image' | 'file'; value: string; label?: string }[] = []
    for (const line of content.split('\n')) {
      const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
      if (imgMatch) { result.push({ type: 'image', value: imgMatch[2], label: imgMatch[1] }); continue }
      const fileMatch = line.match(/^\[([^\]]+)\]\(([^)]+)\)\s*$/)
      if (fileMatch) { result.push({ type: 'file', value: fileMatch[2], label: fileMatch[1] }); continue }
      result.push({ type: 'text', value: line })
    }
    return result
  }, [content])

  return (
    <div className="chat-user-content">
      {parts.map((p, i) => {
        if (p.type === 'image') return <img key={i} src={p.value} alt={p.label} className="chat-user-img" />
        if (p.type === 'file') return <a key={i} href={p.value} target="_blank" rel="noopener" className="chat-attach-tag"><Paperclip size={11} />{p.label?.replace(/^📎\s*/, '') || 'file'}</a>
        if (!p.value.trim()) return null
        return <span key={i} className="chat-user-text">{p.value}</span>
      })}
    </div>
  )
}

// --- 消息复制按钮 ---
function MessageCopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
    } else {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <button onClick={handleCopy} className="chat-msg-copy" aria-label="复制消息" title="复制">
      {copied ? <Check size={12} weight="bold" className="text-green-500" /> : <Copy size={12} />}
    </button>
  )
}

// --- 主组件 ---
export function ChatPage({ currentPath, onSwitchMode, onNavigate, onRefresh }: { currentPath: string; onSwitchMode?: () => void; onNavigate?: (path: string) => void; onRefresh?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const pathRef = useRef(currentPath)
  const [loading, setLoading] = useState(false)
  const [toolHint, setToolHint] = useState('')
  const [dragging, setDragging] = useState(false)
  const [inputEmpty, setInputEmpty] = useState(true)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [pinContext, setPinContext] = useState(() => localStorage.getItem('chat-pin-context') === 'true')
  const [pinnedPath, setPinnedPath] = useState(() => localStorage.getItem('chat-pinned-path') || '')
  const [chatMode, setChatMode] = useState<'personal' | 'shared'>(() => (localStorage.getItem('chat-mode') as 'personal' | 'shared') || 'shared')
  const chatModeRef = useRef((localStorage.getItem('chat-mode') as 'personal' | 'shared') || 'shared')
  useEffect(() => { chatModeRef.current = chatMode }, [chatMode])
  const abortRef = useRef<AbortController | null>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reducedMotion = useReducedMotion()

  // 输入框内容保留（关闭/刷新时保存，打开时恢复）
  const inputStorageKey = `chat-input-draft:${currentPath || '/'}`
  useEffect(() => {
    // 恢复草稿
    const draft = sessionStorage.getItem(inputStorageKey)
    if (draft && inputRef.current && !inputRef.current.innerHTML) {
      inputRef.current.innerHTML = draft
      setInputEmpty(false)
      // 光标移到末尾
      const sel = window.getSelection()
      if (sel) { sel.selectAllChildren(inputRef.current); sel.collapseToEnd() }
    }
  }, [inputStorageKey])
  // 页面卸载时保存草稿
  useEffect(() => {
    const saveDraft = () => {
      const el = inputRef.current
      if (el) {
        const html = el.innerHTML
        if (html && html !== '<br>') sessionStorage.setItem(inputStorageKey, html)
        else sessionStorage.removeItem(inputStorageKey)
      }
    }
    window.addEventListener('beforeunload', saveDraft)
    return () => { saveDraft(); window.removeEventListener('beforeunload', saveDraft) }
  }, [inputStorageKey])
  const [theme, setTheme] = useState<'dark' | 'light' | 'auto'>(() => {
    if (typeof window === 'undefined') return 'auto'
    return (localStorage.getItem('theme') as 'dark' | 'light' | 'auto') || 'auto'
  })
  const toggleTheme = () => {
    setTheme(t => {
      const next = t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'
      document.documentElement.setAttribute('data-theme', next)
      localStorage.setItem('theme', next)
      return next
    })
  }
  const isNearBottom = useRef(true)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  // Cmd+K 快捷键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => {
    if (pinContext) { pathRef.current = pinnedPath; return }
    pathRef.current = currentPath
    loadMessages(currentPath)
  }, [currentPath, pinContext, pinnedPath, chatMode])

  const loadMessages = useCallback(async (path: string) => {
    const mode = chatModeRef.current
    if (mode === 'shared') {
      try {
        const res = await fetch(`/api/chat/history?path=${encodeURIComponent(path || '/')}`)
        const data = await res.json()
        setMessages(data.messages || [])
        if (data.session) {
          localStorage.setItem(`chat-session:shared:${path || '/'}`, data.session)
        }
      } catch { setMessages([]) }
    } else {
      const key = `chat-history:${path || '/'}`
      const hist = localStorage.getItem(key)
      if (hist) { try { setMessages(JSON.parse(hist)) } catch { setMessages([]) } }
      else { setMessages([]) }
    }
  }, [])

  const saveMessages = useCallback(async (msgs: Message[]) => {
    const mode = chatModeRef.current
    const path = pathRef.current || '/'
    if (mode === 'shared') {
      const session = localStorage.getItem(`chat-session:shared:${path}`) || ''
      try {
        await fetch('/api/chat/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, messages: msgs.slice(-50), session }),
        })
      } catch {}
    } else {
      localStorage.setItem(`chat-history:${path}`, JSON.stringify(msgs.slice(-30)))
    }
  }, [])

  useEffect(() => {
    if (messages.length > 0) saveMessages(messages)
  }, [messages, saveMessages])

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); loadMessages(pathRef.current) }, [])

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  useEffect(() => {
    if (isNearBottom.current) {
      setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 50)
    }
  }, [messages])

  // 上传
  const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
    try {
      const res = await fetch('/api/upload', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file })
      if (!res.ok) return null
      const data = await res.json()
      const filePath = data.path.startsWith('/') ? data.path : `/${data.path}`
      return { name: data.name || file.name, path: filePath, type: file.type.startsWith('image/') ? 'image' : 'file' }
    } catch { return null }
  }, [])

  const insertAttachment = useCallback((att: Attachment) => {
    const el = inputRef.current; if (!el) return
    const node = att.type === 'image'
      ? (() => { const img = document.createElement('img'); img.src = att.path; img.setAttribute('data-path', att.path); img.setAttribute('data-name', att.name); img.className = 'ce-img'; return img })()
      : (() => { const chip = document.createElement('span'); chip.className = 'ce-file'; chip.contentEditable = 'false'; chip.setAttribute('data-path', att.path); chip.setAttribute('data-name', att.name); chip.textContent = att.name; return chip })()
    const spacer = document.createTextNode('\u00A0')
    el.focus()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const range = sel.getRangeAt(0); range.deleteContents(); range.insertNode(spacer); range.insertNode(node); range.setStartAfter(spacer); range.collapse(true); sel.removeAllRanges(); sel.addRange(range)
    } else { el.appendChild(node); el.appendChild(spacer); if (sel) { sel.selectAllChildren(el); sel.collapseToEnd() } }
    setInputEmpty(false)
  }, [])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    for (let i = 0; i < e.clipboardData.items.length; i++) {
      if (e.clipboardData.items[i].type.startsWith('image/')) {
        e.preventDefault(); const file = e.clipboardData.items[i].getAsFile(); if (!file) continue
        const att = await uploadFile(file); if (att) insertAttachment(att); return
      }
    }
    e.preventDefault(); const text = e.clipboardData.getData('text/plain'); if (text) document.execCommand('insertText', false, text)
  }, [uploadFile, insertAttachment])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    for (let i = 0; i < files.length; i++) { const att = await uploadFile(files[i]); if (att) insertAttachment(att) }
    e.target.value = ''
  }, [uploadFile, insertAttachment])

  const extractBlocks = useCallback((): ChatBlock[] => {
    const el = inputRef.current; if (!el) return []
    const blocks: ChatBlock[] = []; let text = ''
    const flush = () => { const t = text.replace(/[\u200B\u00A0]+/g, ' ').trim(); if (t) blocks.push({ type: 'text', content: t }); text = '' }
    const walk = (node: Node) => {
      if (node.nodeType === 3) text += node.textContent || ''
      else if (node.nodeName === 'IMG') { flush(); const p = (node as HTMLElement).getAttribute('data-path') || ''; if (p) blocks.push({ type: 'image', content: p }) }
      else if (node.nodeName === 'BR') text += '\n'
      else if ((node as HTMLElement).classList?.contains('ce-file')) { flush(); const p = (node as HTMLElement).getAttribute('data-path') || ''; const n = (node as HTMLElement).getAttribute('data-name') || 'file'; if (p) blocks.push({ type: 'file', content: p, name: n }) }
      else if (node.nodeName === 'DIV' || node.nodeName === 'P') { if (text && !text.endsWith('\n')) text += '\n'; for (const c of node.childNodes) walk(c); if (!text.endsWith('\n')) text += '\n' }
      else { for (const c of node.childNodes) walk(c) }
    }
    for (const c of el.childNodes) walk(c); flush(); return blocks
  }, [])

  const stopGeneration = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setLoading(false); setToolHint('') }, [])

  const clearChat = useCallback(() => {
    setMessages([]); const ctxPath = pinContext ? pinnedPath : currentPath
    const prefix = chatMode === 'shared' ? 'shared' : 'personal'
    localStorage.removeItem(`chat-history:${ctxPath || '/'}`); localStorage.removeItem(`chat-session:${prefix}:${ctxPath || '/'}`); setToolHint('')
  }, [currentPath, pinContext, pinnedPath, chatMode])

  const send = async (retryContent?: string) => {
    let blocks: ChatBlock[]
    let content: string
    let attachments: Attachment[]

    if (retryContent) {
      // 重试模式：直接使用传入的内容
      content = retryContent
      blocks = [{ type: 'text', content: retryContent }]
      attachments = []
    } else {
      blocks = extractBlocks(); if (blocks.length === 0 || loading) return
      if (inputRef.current) inputRef.current.innerHTML = ''; setInputEmpty(true)
      // 清除草稿
      sessionStorage.removeItem(inputStorageKey)
      content = blocks.map(b => b.type === 'text' ? b.content : b.type === 'image' ? `![](${b.content})` : `[${b.name || 'file'}](${b.content})`).join('\n')
      attachments = blocks.filter(b => b.type === 'image' || b.type === 'file').map(b => ({ name: b.name || '', path: b.content, type: b.type as 'image' | 'file' }))
      setMessages(prev => [...prev, { role: 'user', content, attachments, timestamp: Date.now() }])
    }

    setLoading(true)
    try {
      const ctxPath = pinContext ? pinnedPath : currentPath
      const sessionPrefix = chatMode === 'shared' ? 'shared' : 'personal'
      const sessionKey = `chat-session:${sessionPrefix}:${ctxPath || '/'}`
      const session = localStorage.getItem(sessionKey) || `web-${Math.random().toString(36).slice(2, 10)}`
      if (!localStorage.getItem(sessionKey)) localStorage.setItem(sessionKey, session)
      const controller = new AbortController(); abortRef.current = controller
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks, session, context_path: pinContext ? `/notes/${pinnedPath}` : `/notes/${currentPath}`, ...(pinContext && currentPath !== pinnedPath ? { ref_path: `/notes/${currentPath}` } : {}) }), signal: controller.signal })
      const reader = res.body?.getReader(); const decoder = new TextDecoder(); let fullText = ''
      if (reader) {
        setMessages(prev => [...prev, { role: 'bot', content: '', timestamp: Date.now() }]); let buf = ''; let shouldRefresh = false
        const viewingName = currentPath ? decodeURIComponent(currentPath.split('/').pop() || '') : ''
        const viewingDir = currentPath || ''
        const isWriteToViewing = (text: string) => {
          if (!viewingName && !viewingDir) return false
          const isWrite = /writ|creat|sav|updat|edit|modif|delet|remov|mov|renam|mkdir|cp |append/i.test(text)
          if (!isWrite) return false
          return (viewingName && text.includes(viewingName)) || (viewingDir && text.includes(viewingDir))
        }
        while (true) {
          const { done, value } = await reader.read(); if (done) break
          buf += decoder.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6))
              if (ev.type === 'text' && ev.content) { setToolHint(''); fullText += ev.content; setMessages(prev => { const n = [...prev]; const last = n[n.length - 1]; n[n.length - 1] = { ...last, content: fullText }; return n }) }
              else if (ev.type === 'tool' && ev.content) { setToolHint(ev.content); if (isWriteToViewing(ev.content)) shouldRefresh = true }
              else if (ev.type === 'file') { setToolHint(''); fullText += ev.is_image ? `\n![${ev.name}](${ev.url})\n` : `\n[${ev.name}](${ev.url})\n`; setMessages(prev => { const n = [...prev]; const last = n[n.length - 1]; n[n.length - 1] = { ...last, content: fullText }; return n }) }
              else if (ev.type === 'done') { setToolHint(''); if (shouldRefresh) onRefresh?.() }
            } catch {}
          }
        }
        // 流结束后检查是否有内容
        if (!fullText.trim()) {
          setMessages(prev => { const n = [...prev]; n[n.length - 1] = { role: 'bot', content: '⚠️ 未收到回复，请重试。', failed: true }; return n })
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'bot', content: `请求失败: ${(e as Error).message || e}`, failed: true, timestamp: Date.now() }])
      }
    }
    finally { setLoading(false); setToolHint(''); abortRef.current = null }
  }

  // 重试：移除失败的 bot 消息，重新发送
  const retry = useCallback(() => {
    setMessages(prev => {
      // 找到最后一条 user 消息
      const lastUserIdx = prev.map((m, i) => ({ m, i })).filter(x => x.m.role === 'user').pop()?.i
      if (lastUserIdx === undefined) return prev
      const userMsg = prev[lastUserIdx]
      // 移除该 user 消息之后的所有 bot 消息
      const next = prev.slice(0, lastUserIdx + 1)
      // 下一个 tick 重新发送
      setTimeout(() => send(userMsg.content), 0)
      return next
    })
  }, [pinContext, pinnedPath, currentPath, chatMode])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false) }, [])
  const handleDrop = useCallback(async (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false); const files = e.dataTransfer.files; if (!files || files.length === 0) return; for (let i = 0; i < files.length; i++) { const att = await uploadFile(files[i]); if (att) insertAttachment(att) } }, [uploadFile, insertAttachment])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold') }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic') }
    if (e.key === 'Backspace') {
      const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return; const range = sel.getRangeAt(0); if (!range.collapsed) return
      const { startContainer, startOffset } = range; let target: Node | null = null
      if (startContainer.nodeType === 3 && startOffset === 0) target = startContainer.previousSibling
      else if (startContainer.nodeType === 1 && startOffset > 0) target = startContainer.childNodes[startOffset - 1]
      if (target && target.nodeType === 1) { const el = target as HTMLElement; if (el.classList?.contains('ce-file') || el.classList?.contains('ce-img') || el.tagName === 'IMG') { e.preventDefault(); el.remove(); checkInputEmpty() } }
    }
  }

  const checkInputEmpty = useCallback(() => {
    const el = inputRef.current; if (!el) return
    const hasContent = !!(el.textContent?.trim() || el.querySelector('img, .ce-file'))
    setInputEmpty(!hasContent); if (!hasContent && el.innerHTML !== '') el.innerHTML = ''
  }, [])

  const handleImgClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG' && target.closest('.chat-page-messages')) setLightboxSrc((target as HTMLImageElement).src)
  }, [])

  const mdComponents = useMemo(() => ({
    pre({ children }: any) { return <>{children}</> },
    code({ className, children, ...props }: any) {
      const isBlock = className?.startsWith('language-') || (typeof children === 'string' && children.includes('\n'))
      if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>
      return <code className="chat-inline-code" {...props}>{children}</code>
    },
    img({ src, alt }: any) { return <img src={src} alt={alt} className="chat-md-img" onClick={() => setLightboxSrc(src)} /> },
    a({ href, children }: any) { return <a href={href} target="_blank" rel="noopener" className="chat-md-link">{children}</a> },
    table({ children }: any) { return <div className="chat-table-wrap"><table>{children}</table></div> },
    td({ children }: any) {
      const text = typeof children === 'string' ? children : Array.isArray(children) ? children.map((c: any) => typeof c === 'string' ? c : '').join('') : ''
      return <td className={text.length > 15 ? 'chat-td-wrap' : ''}>{children}</td>
    },
  }), [])

  return (
    <div className="chat-page" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 bg-[var(--color-bg)]/80 backdrop-blur-md border-b border-[var(--color-border)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <Breadcrumb currentPath={currentPath} onNavigate={(path) => onNavigate?.(path)} />
          <div className="flex items-center gap-1.5">
            {onSwitchMode && (
              <button
                onClick={onSwitchMode}
                className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                aria-label="文件模式"
                title="切换到文件模式"
              >
                <Notebook size={16} />
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
              aria-label="切换主题"
              title={theme === 'dark' ? '暗色' : theme === 'light' ? '亮色' : '跟随系统'}
            >
              {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <CircleHalf size={16} />}
            </button>
            <button
              onClick={() => setSearchOpen(true)}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
              aria-label="搜索"
              title="搜索 (⌘K)"
            >
              <MagnifyingGlass size={16} />
            </button>
          </div>
        </div>
      </header>
      {/* 拖拽层 */}
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="chat-drop-zone">
            <Paperclip size={20} /><span>松开上传</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 消息区 */}
      <div className="chat-page-messages" ref={messagesContainerRef} onScroll={handleScroll} onClick={handleImgClick}>
        <div className="chat-page-messages__inner">
          {messages.length === 0 && (
            <div className="chat-page-welcome">
              <h2>有什么可以帮你？</h2>
              <p>输入问题开始对话</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble--user' : 'chat-bubble--bot'} group`}>
              <div className="chat-bubble__body">
                {msg.role === 'bot' ? (
                  <div className="chat-bubble__md markdown-body">
                    {msg.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
                    ) : loading && i === messages.length - 1 ? (
                      <div className="chat-dots"><span /><span /><span /></div>
                    ) : null}
                  </div>
                ) : (
                  <UserMessageContent content={msg.content} />
                )}
                {loading && i === messages.length - 1 && msg.role === 'bot' && toolHint && (
                  <div className="chat-tool-hint"><span className="chat-spinner" /><span className="chat-tool-text">{toolHint}</span></div>
                )}
                {/* 重试按钮 */}
                {msg.failed && !loading && (
                  <button onClick={retry} className="chat-retry-btn" title="重试">
                    <ArrowClockwise size={12} /> 重试
                  </button>
                )}
                {/* 底部：复制 + 时间 */}
                <div className={`chat-msg-footer ${msg.role === 'user' ? 'chat-msg-footer--right' : ''}`}>
                  {msg.role === 'bot' && msg.content && !(loading && i === messages.length - 1) && (
                    <MessageCopyBtn text={msg.content} />
                  )}
                  {msg.timestamp && (
                    <time className="chat-msg-time">
                      {formatMsgTime(msg.timestamp)}
                    </time>
                  )}
                  {msg.role === 'user' && msg.content && (
                    <MessageCopyBtn text={msg.content} />
                  )}
                </div>
              </div>
            </div>
          ))}

          {messages.length > 0 && !loading && (
            <div className="flex items-center gap-2 -mt-2">
              <div className="flex-1 h-px bg-[var(--color-border)]" />
              <button onClick={clearChat} className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-accent)] transition-colors cursor-pointer px-2">新对话</button>
              <div className="flex-1 h-px bg-[var(--color-border)]" />
            </div>
          )}
          <div ref={messagesEnd} />
        </div>
      </div>

      {/* 输入区 */}
      <div className="chat-page-composer">
        <div className="chat-page-composer__context">
          <span className="chat-context-label">
            {pinContext
              ? <>{pinnedPath ? decodeURIComponent(pinnedPath.split('/').pop() || '') : 'Notes'}
                  {currentPath !== pinnedPath && <span className="chat-context-ref"> › {decodeURIComponent(currentPath.split('/').pop() || 'Notes')}</span>}
                </>
              : <>{currentPath ? decodeURIComponent(currentPath.split('/').pop() || '') : 'Notes'}</>
            }
          </span>
          <button
            className={`chat-context-lock ${pinContext ? 'chat-context-lock--active' : ''}`}
            onClick={() => {
              const next = !pinContext; setPinContext(next); localStorage.setItem('chat-pin-context', String(next))
              if (next) { setPinnedPath(currentPath); localStorage.setItem('chat-pinned-path', currentPath) }
              else { setPinnedPath(''); localStorage.removeItem('chat-pinned-path'); pathRef.current = currentPath; const key = `chat-history:${currentPath || '/'}`; const hist = localStorage.getItem(key); if (hist) { try { setMessages(JSON.parse(hist)) } catch { setMessages([]) } } else setMessages([]) }
            }}
            title={pinContext ? '解锁上下文' : '锁定上下文'}
          >
            {pinContext ? <Lock size={12} weight="bold" /> : <LockOpen size={12} />}
          </button>
          <button
            className={`chat-context-lock ${chatMode === 'personal' ? 'chat-context-lock--active' : ''}`}
            onClick={() => {
              const next = chatMode === 'personal' ? 'shared' : 'personal'
              setChatMode(next)
              chatModeRef.current = next
              localStorage.setItem('chat-mode', next)
              loadMessages(pathRef.current)
            }}
            title={chatMode === 'personal' ? '个人模式（点击切到共享）' : '共享模式（点击切到个人）'}
          >
            {chatMode === 'personal' ? <User size={12} weight="bold" /> : <UsersThree size={12} />}
          </button>
        </div>
        <div className="chat-page-composer__box">
          <div
            ref={inputRef}
            contentEditable
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onInput={checkInputEmpty}
            onClick={(e) => {
              const target = e.target as HTMLElement
              if (target.tagName === 'IMG' && target.classList.contains('ce-img')) setLightboxSrc((target as HTMLImageElement).src)
              else if (target.classList.contains('ce-file')) { const path = target.getAttribute('data-path'); if (path) window.open(path, '_blank') }
            }}
            data-placeholder="输入消息…"
            className="chat-page-input"
          />
          <div className="chat-page-composer__actions">
            <button onClick={() => fileInputRef.current?.click()} className="chat-icon-btn" title="添加附件"><Paperclip size={18} /></button>
            {loading ? (
              <button onClick={stopGeneration} className="chat-page-send chat-page-send--stop" aria-label="停止"><Stop size={16} weight="fill" /></button>
            ) : (
              <button onClick={() => send()} disabled={inputEmpty} className="chat-page-send" aria-label="发送"><PaperPlaneRight size={16} weight="bold" /></button>
            )}
          </div>
        </div>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxSrc && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }} className="chat-lightbox" onClick={() => setLightboxSrc(null)}>
            <img src={lightboxSrc} alt="预览" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 搜索 */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        currentPath={currentPath}
        onNavigate={(path) => { setSearchOpen(false); onNavigate?.(path) }}
      />
    </div>
  )
}
