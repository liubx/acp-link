import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ChatCircle, PaperPlaneRight, X, Paperclip, Robot, Stop, Copy, Check, Lock, LockOpen, UsersThree, User, ArrowClockwise } from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// --- 类型 ---

interface Attachment {
  name: string
  path: string
  type: 'image' | 'file'
}

interface Message {
  role: 'user' | 'bot'
  content: string
  attachments?: Attachment[]
  timestamp?: number
  failed?: boolean
}

interface ChatBlock {
  type: string
  content: string
  name?: string
}

// --- 时间格式化 ---
function formatMsgTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return time
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

// --- 代码块组件（带复制按钮）---

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const lang = className?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')
  const lines = code.split('\n')

  const handleCopy = () => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    } else {
      const ta = document.createElement('textarea')
      ta.value = code
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)] my-2">
      <div className="px-3 py-1.5 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-dim)] font-mono uppercase">{lang || 'code'}</span>
        <button
          onClick={handleCopy}
          className="text-[var(--color-muted)] hover:text-[var(--color-fg)] p-1 rounded hover:bg-[var(--color-border)] transition-colors cursor-pointer"
          aria-label="复制"
        >
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

// --- 用户消息渲染（支持图文混排）---

function UserMessageContent({ content }: { content: string }) {
  const parts = useMemo(() => {
    if (!content) return []
    const result: { type: 'text' | 'image' | 'file'; value: string; label?: string }[] = []
    const lines = content.split('\n')

    for (const line of lines) {
      const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
      if (imgMatch) {
        result.push({ type: 'image', value: imgMatch[2], label: imgMatch[1] })
        continue
      }
      const fileMatch = line.match(/^\[([^\]]+)\]\(([^)]+)\)\s*$/)
      if (fileMatch) {
        result.push({ type: 'file', value: fileMatch[2], label: fileMatch[1] })
        continue
      }
      // 行内图片/文件提取
      if (line.includes('![') || line.includes('](')) {
        // 简单处理：整行当文本，去掉 markdown 语法
        result.push({ type: 'text', value: line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1]').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') })
      } else {
        result.push({ type: 'text', value: line })
      }
    }
    return result
  }, [content])

  return (
    <div className="chat-user-content">
      {parts.map((part, i) => {
        if (part.type === 'image') {
          return <img key={i} src={part.value} alt={part.label} className="chat-user-img" />
        }
        if (part.type === 'file') {
          return (
            <a key={i} href={part.value} target="_blank" rel="noopener" className="chat-attach-tag">
              <Paperclip size={11} />
              {part.label?.replace(/^📎\s*/, '') || 'file'}
            </a>
          )
        }
        if (!part.value.trim()) return null
        return <span key={i} className="chat-user-text">{part.value}</span>
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

export function ChatFab({ currentPath, onRefresh }: { currentPath: string; onRefresh?: () => void }) {
  const [open, setOpen] = useState(false)
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

  // 输入框内容保留
  const inputStorageKey = `chat-fab-draft:${currentPath || '/'}`
  useEffect(() => {
    if (open) {
      const draft = sessionStorage.getItem(inputStorageKey)
      if (draft && inputRef.current && !inputRef.current.innerHTML) {
        inputRef.current.innerHTML = draft
        setInputEmpty(false)
        // 光标移到末尾
        setTimeout(() => {
          const sel = window.getSelection()
          if (sel && inputRef.current) { sel.selectAllChildren(inputRef.current); sel.collapseToEnd() }
        }, 0)
      }
    }
  }, [open, inputStorageKey])
  // 关闭时保存草稿
  useEffect(() => {
    if (!open) {
      // open 刚变 false 时保存
      const el = inputRef.current
      if (el) {
        const html = el.innerHTML
        if (html && html !== '<br>') sessionStorage.setItem(inputStorageKey, html)
        else sessionStorage.removeItem(inputStorageKey)
      }
    }
  }, [open, inputStorageKey])
  // 页面卸载时也保存
  useEffect(() => {
    const saveDraft = () => {
      const el = inputRef.current
      if (el && open) {
        const html = el.innerHTML
        if (html && html !== '<br>') sessionStorage.setItem(inputStorageKey, html)
        else sessionStorage.removeItem(inputStorageKey)
      }
    }
    window.addEventListener('beforeunload', saveDraft)
    return () => window.removeEventListener('beforeunload', saveDraft)
  }, [inputStorageKey, open])

  // 路径变化时切换对话
  useEffect(() => {
    if (pinContext) { pathRef.current = pinnedPath; return }
    pathRef.current = currentPath
    loadMessages(currentPath)
  }, [currentPath, pinContext, pinnedPath, chatMode])

  // 加载消息（根据模式）
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

  // 保存消息（根据模式）
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

  // 保存历史（消息变化时，但切模式导致的清空不保存）
  const skipSaveRef = useRef(false)
  useEffect(() => {
    if (skipSaveRef.current) { skipSaveRef.current = false; return }
    if (messages.length > 0) saveMessages(messages)
  }, [messages, saveMessages])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      loadMessages(pathRef.current)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxSrc) setLightboxSrc(null)
        else setOpen(false)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [open, lightboxSrc])

  // 智能滚动：只有用户在底部附近时才自动滚动
  const isNearBottom = useRef(true)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    // 距底部 80px 以内算"在底部"
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  useEffect(() => {
    if (isNearBottom.current) {
      setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 50)
    }
  }, [messages, open])

  // --- 文件上传 ---
  const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      if (!res.ok) return null
      const data = await res.json()
      const isImage = file.type.startsWith('image/')
      const filePath = data.path.startsWith('/') ? data.path : `/${data.path}`
      return { name: data.name || file.name, path: filePath, type: isImage ? 'image' : 'file' }
    } catch { return null }
  }, [])

  // --- 插入附件到输入框（在光标位置）---
  const insertAttachment = useCallback((att: Attachment) => {
    const el = inputRef.current
    if (!el) return

    const node = att.type === 'image'
      ? (() => {
          const img = document.createElement('img')
          img.src = att.path
          img.setAttribute('data-path', att.path)
          img.setAttribute('data-name', att.name)
          img.className = 'ce-img'
          return img
        })()
      : (() => {
          const chip = document.createElement('span')
          chip.className = 'ce-file'
          chip.contentEditable = 'false'
          chip.setAttribute('data-path', att.path)
          chip.setAttribute('data-name', att.name)
          chip.textContent = att.name
          return chip
        })()

    const spacer = document.createTextNode('\u00A0')

    el.focus()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      // 确保光标在输入框内
      if (el.contains(range.commonAncestorContainer)) {
        range.deleteContents()
        range.insertNode(spacer)
        range.insertNode(node)
        // 光标移到 spacer 之后
        range.setStartAfter(spacer)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        // 光标不在输入框内，追加到末尾
        el.appendChild(node)
        el.appendChild(spacer)
        sel.selectAllChildren(el)
        sel.collapseToEnd()
      }
    } else {
      el.appendChild(node)
      el.appendChild(spacer)
      if (sel) {
        sel.selectAllChildren(el)
        sel.collapseToEnd()
      }
    }

    setInputEmpty(false)
    // 滚动输入框到光标位置
    setTimeout(() => {
      const cursor = el.querySelector(':focus') || spacer
      if (cursor && 'scrollIntoView' in cursor) {
        (cursor as HTMLElement).scrollIntoView?.({ block: 'nearest' })
      } else {
        el.scrollTop = el.scrollHeight
      }
    }, 0)
  }, [])

  // --- 粘贴 ---
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault()
        const file = items[i].getAsFile()
        if (!file) continue
        const att = await uploadFile(file)
        if (att) insertAttachment(att)
        return
      }
    }
    // 非图片：强制纯文本
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) document.execCommand('insertText', false, text)
  }, [uploadFile, insertAttachment])

  // --- 文件选择 ---
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const att = await uploadFile(files[i])
      if (att) insertAttachment(att)
    }
    e.target.value = ''
  }, [uploadFile, insertAttachment])

  // --- 图片点击放大 ---
  const handleImgClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG' && target.closest('.chat-messages')) {
      setLightboxSrc((target as HTMLImageElement).src)
    }
  }, [])

  // --- 清除对话 ---
  const clearChat = useCallback(() => {
    setMessages([])
    const ctxPath = pinContext ? pinnedPath : currentPath
    const prefix = chatMode === 'shared' ? 'shared' : 'personal'
    localStorage.removeItem(`chat-history:${ctxPath || '/'}`)
    localStorage.removeItem(`chat-session:${prefix}:${ctxPath || '/'}`)
    setToolHint('')
  }, [currentPath, pinContext, pinnedPath, chatMode])

  // --- 停止 ---
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setToolHint('')
  }, [])

  // --- 提取输入内容 ---
  const extractBlocks = useCallback((): ChatBlock[] => {
    const el = inputRef.current
    if (!el) return []
    const blocks: ChatBlock[] = []
    let text = ''

    const flush = () => {
      const t = text.replace(/[\u200B\u00A0]+/g, ' ').trim()
      if (t) blocks.push({ type: 'text', content: t })
      text = ''
    }

    const walk = (node: Node) => {
      if (node.nodeType === 3) {
        text += node.textContent || ''
      } else if (node.nodeName === 'IMG') {
        flush()
        const path = (node as HTMLElement).getAttribute('data-path') || ''
        if (path) blocks.push({ type: 'image', content: path })
      } else if (node.nodeName === 'BR') {
        text += '\n'
      } else if ((node as HTMLElement).classList?.contains('ce-file')) {
        flush()
        const path = (node as HTMLElement).getAttribute('data-path') || ''
        const name = (node as HTMLElement).getAttribute('data-name') || 'file'
        if (path) blocks.push({ type: 'file', content: path, name })
      } else if (node.nodeName === 'DIV' || node.nodeName === 'P') {
        if (text && !text.endsWith('\n')) text += '\n'
        for (const child of node.childNodes) walk(child)
        if (!text.endsWith('\n')) text += '\n'
      } else {
        for (const child of node.childNodes) walk(child)
      }
    }

    for (const child of el.childNodes) walk(child)
    flush()
    return blocks
  }, [])

  // --- 发送 ---
  const send = async (retryContent?: string) => {
    let blocks: ChatBlock[]
    let content: string
    let attachments: Attachment[]

    if (retryContent) {
      content = retryContent
      blocks = [{ type: 'text', content: retryContent }]
      attachments = []
    } else {
      blocks = extractBlocks()
      if (blocks.length === 0 || loading) return
      if (inputRef.current) inputRef.current.innerHTML = ''
      setInputEmpty(true)
      sessionStorage.removeItem(inputStorageKey)

      content = blocks.map(b => {
        if (b.type === 'text') return b.content
        if (b.type === 'image') return `![](${b.content})`
        if (b.type === 'file') return `[${b.name || 'file'}](${b.content})`
        return ''
      }).join('\n')

      attachments = blocks
        .filter(b => b.type === 'image' || b.type === 'file')
        .map(b => ({ name: b.name || '', path: b.content, type: b.type as 'image' | 'file' }))

      setMessages(prev => [...prev, { role: 'user', content, attachments, timestamp: Date.now() }])
    }

    setLoading(true)

    try {
      const ctxPath = pinContext ? pinnedPath : currentPath
      const sessionPrefix = chatMode === 'shared' ? 'shared' : 'personal'
      const sessionKey = `chat-session:${sessionPrefix}:${ctxPath || '/'}`
      const session = localStorage.getItem(sessionKey) || `web-${Math.random().toString(36).slice(2, 10)}`
      if (!localStorage.getItem(sessionKey)) localStorage.setItem(sessionKey, session)

      const controller = new AbortController()
      abortRef.current = controller

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks,
          session,
          context_path: pinContext ? `/notes/${pinnedPath}` : location.pathname,
          ...(pinContext && currentPath !== pinnedPath ? { ref_path: location.pathname } : {}),
        }),
        signal: controller.signal,
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      if (reader) {
        setMessages(prev => [...prev, { role: 'bot', content: '', timestamp: Date.now() }])
        let buf = ''
        let shouldRefresh = false
        const viewingName = currentPath ? decodeURIComponent(currentPath.split('/').pop() || '') : ''
        const viewingDir = currentPath || ''
        // 判断 tool 内容是否是对当前文件/目录的写操作
        const isWriteToViewing = (text: string) => {
          if (!viewingName && !viewingDir) return false
          const lower = text.toLowerCase()
          const isWrite = /writ|creat|sav|updat|edit|modif|delet|remov|mov|renam|mkdir|cp |append/i.test(lower)
          if (!isWrite) return false
          if (viewingName && text.includes(viewingName)) return true
          if (viewingDir && text.includes(viewingDir)) return true
          return false
        }
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6))
              if (ev.type === 'text' && ev.content) {
                setToolHint('')
                fullText += ev.content
                setMessages(prev => {
                  const next = [...prev]
                  const last = next[next.length - 1]
                  next[next.length - 1] = { ...last, content: fullText }
                  return next
                })
              } else if (ev.type === 'tool' && ev.content) {
                setToolHint(ev.content)
                if (isWriteToViewing(ev.content)) shouldRefresh = true
              } else if (ev.type === 'file') {
                setToolHint('')
                fullText += ev.is_image
                  ? `\n![${ev.name}](${ev.url})\n`
                  : `\n[${ev.name}](${ev.url})\n`
                setMessages(prev => {
                  const next = [...prev]
                  const last = next[next.length - 1]
                  next[next.length - 1] = { ...last, content: fullText }
                  return next
                })
              } else if (ev.type === 'done') {
                setToolHint('')
                if (shouldRefresh) onRefresh?.()
              }
            } catch { /* skip */ }
          }
        }
        // 流结束后检查是否有内容
        if (!fullText.trim()) {
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { role: 'bot', content: '⚠️ 未收到回复，请重试。', failed: true }
            return next
          })
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'bot', content: `请求失败: ${(e as Error).message || e}`, failed: true, timestamp: Date.now() }])
      }
    } finally {
      setLoading(false)
      setToolHint('')
      abortRef.current = null
    }
  }

  // 重试
  const retry = useCallback(() => {
    setMessages(prev => {
      const lastUserIdx = prev.map((m, i) => ({ m, i })).filter(x => x.m.role === 'user').pop()?.i
      if (lastUserIdx === undefined) return prev
      const userMsg = prev[lastUserIdx]
      const next = prev.slice(0, lastUserIdx + 1)
      setTimeout(() => send(userMsg.content), 0)
      return next
    })
  }, [pinContext, pinnedPath, currentPath, chatMode])

  // --- 拖拽 ---
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false) }, [])
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    for (let i = 0; i < files.length; i++) {
      const att = await uploadFile(files[i])
      if (att) insertAttachment(att)
    }
  }, [uploadFile, insertAttachment])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
    // Ctrl/Cmd+B 加粗
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold') }
    // Ctrl/Cmd+I 斜体
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic') }
    // 退格删除 contentEditable=false 的附件节点
    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!range.collapsed) return // 有选区，浏览器自己处理
      const { startContainer, startOffset } = range
      let target: Node | null = null
      if (startContainer.nodeType === 3 && startOffset === 0) {
        // 光标在文本节点开头，前一个兄弟可能是附件
        target = startContainer.previousSibling
      } else if (startContainer.nodeType === 1 && startOffset > 0) {
        // 光标在元素内，前一个子节点可能是附件
        target = startContainer.childNodes[startOffset - 1]
      }
      if (target && target.nodeType === 1) {
        const el = target as HTMLElement
        if (el.classList?.contains('ce-file') || el.classList?.contains('ce-img') || el.tagName === 'IMG') {
          e.preventDefault()
          el.remove()
          checkInputEmpty()
        }
      }
    }
  }

  const checkInputEmpty = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const hasContent = !!(el.textContent?.trim() || el.querySelector('img, .ce-file'))
    setInputEmpty(!hasContent)
    // 清理残留 <br>，让 :empty 伪类生效显示 placeholder
    if (!hasContent && el.innerHTML !== '') {
      el.innerHTML = ''
    }
  }, [])

  // --- react-markdown 组件映射 ---
  const mdComponents = useMemo(() => ({
    pre({ children }: any) {
      // 直接透传，让内部 CodeBlock 自己控制样式
      return <>{children}</>
    },
    code({ className, children, ...props }: any) {
      const isBlock = className?.startsWith('language-') || (typeof children === 'string' && children.includes('\n'))
      if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>
      return <code className="chat-inline-code" {...props}>{children}</code>
    },
    img({ src, alt }: any) {
      return <img src={src} alt={alt} className="chat-md-img" onClick={() => setLightboxSrc(src)} />
    },
    a({ href, children }: any) {
      return <a href={href} target="_blank" rel="noopener" className="chat-md-link">{children}</a>
    },
    table({ children }: any) { return <div className="chat-table-wrap"><table>{children}</table></div> },
    td({ children }: any) {
      const text = typeof children === 'string' ? children : Array.isArray(children) ? children.map((c: any) => typeof c === 'string' ? c : '').join('') : ''
      const isLong = text.length > 15
      return <td className={isLong ? 'chat-td-wrap' : ''}>{children}</td>
    },
  }), [])

  return (
    <>
      {/* FAB */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: reducedMotion ? 1 : 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: reducedMotion ? 1 : 0.8, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.4, 0, 0.2, 1] }}
            onClick={() => setOpen(true)}
            className="chat-fab-btn"
            aria-label="打开聊天"
          >
            <ChatCircle size={22} weight="fill" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* 面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.4, 0, 0.2, 1] }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`chat-panel ${dragging ? 'chat-panel--drag' : ''}`}
          >
            {/* 头部 */}
            <header className="chat-header">
              <div className="chat-header__left">
                <div className="chat-header__icon"><Robot size={14} weight="bold" /></div>
                <span className="chat-header__title">AI 助手</span>
                {loading && <span className="chat-header__badge">回答中</span>}
              </div>
              <div className="chat-header__actions">
                <button onClick={() => setOpen(false)} className="chat-icon-btn" aria-label="关闭"><X size={14} weight="bold" /></button>
              </div>
            </header>

            {/* 拖拽层 */}
            <AnimatePresence>
              {dragging && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="chat-drop-zone">
                  <Paperclip size={20} />
                  <span>松开上传</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 消息区 */}
            <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll} onClick={handleImgClick}>
              {messages.length === 0 && (
                <div className="chat-welcome">
                  <div className="chat-welcome__icon"><ChatCircle size={24} weight="light" /></div>
                  <p>有什么可以帮你？</p>
                  <span>发消息开始对话 · 支持图片和文件</span>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble--user' : 'chat-bubble--bot'} group`}>
                  <div className="chat-bubble__body">
                    {msg.role === 'bot' ? (
                      <div className="chat-bubble__md markdown-body">
                        {msg.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {msg.content}
                          </ReactMarkdown>
                        ) : loading && i === messages.length - 1 ? (
                          <div className="chat-dots"><span /><span /><span /></div>
                        ) : null}
                      </div>
                    ) : (
                      <UserMessageContent content={msg.content} />
                    )}
                    {loading && i === messages.length - 1 && msg.role === 'bot' && toolHint && (
                      <div className="chat-tool-hint">
                        <span className="chat-spinner" />
                        <span className="chat-tool-text">{toolHint}</span>
                      </div>
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
                  <button onClick={clearChat} className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-accent)] transition-colors cursor-pointer px-2">
                    新对话
                  </button>
                  <div className="flex-1 h-px bg-[var(--color-border)]" />
                </div>
              )}
              <div ref={messagesEnd} />
            </div>

            {/* 输入区 */}
            <div className="chat-composer">
              <div className="chat-context-hint">
                <span className="chat-context-label">
                  {pinContext
                    ? <>{pinnedPath ? decodeURIComponent(pinnedPath.split('/').pop() || '') : 'Notes'}
                        {currentPath !== pinnedPath && <span className="chat-context-ref"> → {decodeURIComponent(currentPath.split('/').pop() || 'Notes')}</span>}
                      </>
                    : <>{currentPath ? decodeURIComponent(currentPath.split('/').pop() || '') : 'Notes'}</>
                  }
                </span>
                <button
                  className={`chat-context-lock ${pinContext ? 'chat-context-lock--active' : ''}`}
                  onClick={() => {
                    const next = !pinContext
                    setPinContext(next)
                    localStorage.setItem('chat-pin-context', String(next))
                    if (next) {
                      setPinnedPath(currentPath)
                      localStorage.setItem('chat-pinned-path', currentPath)
                    } else {
                      setPinnedPath('')
                      localStorage.removeItem('chat-pinned-path')
                      pathRef.current = currentPath
                      const key = `chat-history:${currentPath || '/'}`
                      const hist = localStorage.getItem(key)
                      if (hist) {
                        try { setMessages(JSON.parse(hist)) } catch { setMessages([]) }
                      } else {
                        setMessages([])
                      }
                    }
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
              <div className="chat-composer__box">
                <div
                  ref={inputRef}
                  contentEditable
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onInput={checkInputEmpty}
                  onClick={(e) => {
                    const target = e.target as HTMLElement
                    if (target.tagName === 'IMG' && target.classList.contains('ce-img')) {
                      setLightboxSrc((target as HTMLImageElement).src)
                    } else if (target.classList.contains('ce-file')) {
                      const path = target.getAttribute('data-path')
                      if (path) window.open(path, '_blank')
                    }
                  }}
                  data-placeholder="输入消息…"
                  className="chat-composer__input"
                />
                <div className="chat-composer__actions">
                  <button onClick={() => fileInputRef.current?.click()} className="chat-icon-btn" title="添加附件">
                    <Paperclip size={15} />
                  </button>
                  {loading ? (
                    <button onClick={stopGeneration} className="chat-send-btn chat-send-btn--stop" aria-label="停止">
                      <Stop size={13} weight="fill" />
                    </button>
                  ) : (
                    <button onClick={() => send()} disabled={inputEmpty} className="chat-send-btn" aria-label="发送">
                      <PaperPlaneRight size={13} weight="bold" />
                    </button>
                  )}
                </div>
              </div>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxSrc && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.15 }}
            className="chat-lightbox" onClick={() => setLightboxSrc(null)}
          >
            <img src={lightboxSrc} alt="预览" />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
