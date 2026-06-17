import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ChatCircle, PaperPlaneRight, X, Paperclip, Check } from '@phosphor-icons/react'

// --- Markdown 渲染 ---

function renderMarkdown(text: string): string {
  const codeBlocks: string[] = []

  // 闭合的代码块
  let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length
    const escaped = escapeHtml(code.trimEnd())
    codeBlocks.push(
      `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-btn" data-code="${encodeURIComponent(code.trimEnd())}">复制</button></div><pre><code>${escaped}</code></pre></div>`
    )
    return `\x00CODEBLOCK_${idx}\x00`
  })

  // 未闭合的代码块（流式中间状态）
  processed = processed.replace(/```(\w*)\n?([\s\S]*)$/, (_match, lang, code) => {
    const idx = codeBlocks.length
    const escaped = escapeHtml(code)
    codeBlocks.push(
      `<div class="code-block-wrapper streaming"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span></div><pre><code>${escaped}<span class="cursor-blink">|</span></code></pre></div>`
    )
    return `\x00CODEBLOCK_${idx}\x00`
  })

  // 行内格式
  processed = processed.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
  processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="chat-img" />')
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="chat-link">$1</a>')
  processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>')
  processed = processed.replace(/~~(.+?)~~/g, '<del>$1</del>')

  // 表格
  processed = processed.replace(/(?:^|\n)(\|.+\|(?:\n\|[-|: ]+\|)\n(?:\|.+\|\n?)+)/g, (_match, table: string) => {
    const rows = table.trim().split('\n')
    if (rows.length < 2) return table
    const headerCells = rows[0].split('|').filter(c => c.trim())
    const bodyRows = rows.slice(2)
    let html = '<table class="chat-table"><thead><tr>'
    headerCells.forEach(c => { html += `<th>${c.trim()}</th>` })
    html += '</tr></thead><tbody>'
    bodyRows.forEach(row => {
      const cells = row.split('|').filter(c => c.trim())
      html += '<tr>'
      cells.forEach(c => { html += `<td>${c.trim()}</td>` })
      html += '</tr>'
    })
    html += '</tbody></table>'
    return html
  })

  // 逐行处理：列表、引用块、分割线
  const lines = processed.split('\n')
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'
  let inBlockquote = false
  const result: string[] = []

  for (const line of lines) {
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/)
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/)
    const bqMatch = line.match(/^>\s?(.*)$/)
    const hrMatch = /^[-*_]{3,}\s*$/.test(line.trim())

    // 分割线
    if (hrMatch) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false }
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false }
      result.push('<hr class="chat-hr"/>')
      continue
    }

    // 引用块
    if (bqMatch) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false }
      if (!inBlockquote) { result.push('<blockquote class="chat-blockquote">'); inBlockquote = true }
      result.push(bqMatch[1] || '<br/>')
      continue
    } else if (inBlockquote) {
      result.push('</blockquote>')
      inBlockquote = false
    }

    // 列表
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>')
        result.push('<ul class="chat-list">')
        inList = true
        listType = 'ul'
      }
      result.push(`<li>${ulMatch[2]}</li>`)
    } else if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>')
        result.push('<ol class="chat-list">')
        inList = true
        listType = 'ol'
      }
      result.push(`<li>${olMatch[2]}</li>`)
    } else {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false }
      result.push(line)
    }
  }
  if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>')
  if (inBlockquote) result.push('</blockquote>')

  processed = result.join('\n')

  // 处理换行：连续空行合并为一个段落间隔，单个换行为 <br>
  processed = processed
    .replace(/\n{3,}/g, '\n\n')           // 3个以上换行合并为2个
    .replace(/\n\n/g, '</p><p>')          // 双换行 = 段落分隔
    .replace(/\n/g, '<br/>')              // 单换行 = 行内换行
  processed = `<p>${processed}</p>`
  processed = processed.replace(/<p><\/p>/g, '') // 清理空段落

  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`\x00CODEBLOCK_${i}\x00`, block)
  })

  return processed
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 用户消息渲染：只处理图片和文件链接，文本保持原样
function renderUserMessage(text: string): string {
  if (!text) return ''
  let html = escapeHtml(text)
  // 图片 ![name](url) → <img>
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:4px 0;display:block" />')
  // 文件链接 [📎 name](url) → 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:inherit;text-decoration:underline">$1</a>')
  // 换行
  html = html.replace(/\n/g, '<br/>')
  return html
}

// --- 类型定义 ---

interface Attachment {
  name: string
  path: string
  type: 'image' | 'file'
}

interface Message {
  role: 'user' | 'bot'
  content: string
  attachments?: Attachment[]
}

export function ChatFab() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [toolHint, setToolHint] = useState('')
  const [dragging, setDragging] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reducedMotion = useReducedMotion()

  // 加载历史
  useEffect(() => {
    const hist = localStorage.getItem('chat-history')
    if (hist) {
      try { setMessages(JSON.parse(hist)) } catch { /* ignore */ }
    }
  }, [])

  // 保存历史
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('chat-history', JSON.stringify(messages.slice(-30)))
    }
  }, [messages])

  // 打开时聚焦
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // 滚动到底部
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
  }, [messages])

  // 上传文件
  const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'X-Filename': file.name, 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      if (!res.ok) return null
      const data = await res.json()
      const isImage = file.type.startsWith('image/')
      const filePath = data.path.startsWith('/') ? data.path : `/${data.path}`
      return { name: data.name || file.name, path: filePath, type: isImage ? 'image' : 'file' }
    } catch {
      return null
    }
  }, [])

  // 粘贴事件：图片插入编辑区，文本强制纯文本
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const att = await uploadFile(file)
        if (att && inputRef.current) {
          // 插入图片到编辑区
          const img = document.createElement('img')
          img.src = att.path
          img.setAttribute('data-path', att.path)
          img.setAttribute('data-name', att.name)
          img.style.cssText = 'max-width:120px;max-height:80px;border-radius:6px;margin:2px;vertical-align:middle;'
          inputRef.current.focus()
          const sel = window.getSelection()
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0)
            range.deleteContents()
            range.insertNode(img)
            range.setStartAfter(img)
            range.collapse(true)
            sel.removeAllRanges()
            sel.addRange(range)
          } else {
            inputRef.current.appendChild(img)
          }
        }
        return
      }
    }
    // 非图片：强制纯文本粘贴
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) {
      document.execCommand('insertText', false, text)
    }
  }, [uploadFile])

  // 文件选择：上传后插入编辑区
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !inputRef.current) return
    for (let i = 0; i < files.length; i++) {
      const att = await uploadFile(files[i])
      if (att) {
        if (att.type === 'image') {
          const img = document.createElement('img')
          img.src = att.path
          img.setAttribute('data-path', att.path)
          img.setAttribute('data-name', att.name)
          img.style.cssText = 'max-width:120px;max-height:80px;border-radius:6px;margin:2px;vertical-align:middle;'
          inputRef.current.appendChild(img)
        } else {
          const span = document.createElement('span')
          span.className = 'file-tag'
          span.contentEditable = 'false'
          span.setAttribute('data-path', att.path)
          span.setAttribute('data-name', att.name)
          span.textContent = `📎 ${att.name}`
          inputRef.current.appendChild(span)
          inputRef.current.appendChild(document.createTextNode('\u00A0'))
        }
      }
    }
    e.target.value = ''
  }, [uploadFile])

  // 代码块复制
  const handleMessageClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('copy-btn')) {
      const code = decodeURIComponent(target.dataset.code || '')
      navigator.clipboard.writeText(code)
      setCopiedIdx(Date.now())
      setTimeout(() => setCopiedIdx(null), 2000)
    }
  }, [])

  // 从 contenteditable 提取 blocks
  const extractBlocks = useCallback(() => {
    const el = inputRef.current
    if (!el) return { blocks: [] as { type: string; content: string }[], displayHtml: '' }
    const blocks: { type: string; content: string }[] = []
    let currentText = ''

    const flush = () => {
      const t = currentText.trim()
      if (t) blocks.push({ type: 'text', content: t })
      currentText = ''
    }

    const walk = (node: Node) => {
      if (node.nodeType === 3) {
        currentText += node.textContent || ''
      } else if (node.nodeName === 'IMG') {
        flush()
        const path = (node as HTMLElement).getAttribute('data-path') || ''
        if (path) blocks.push({ type: 'image', content: path })
      } else if (node.nodeName === 'BR') {
        currentText += '\n'
      } else if ((node as HTMLElement).classList?.contains('file-tag')) {
        flush()
        const path = (node as HTMLElement).getAttribute('data-path') || ''
        if (path) blocks.push({ type: 'file', content: path })
      } else if (node.nodeName === 'DIV' || node.nodeName === 'P') {
        if (currentText && !currentText.endsWith('\n')) currentText += '\n'
        for (const child of node.childNodes) walk(child)
        if (!currentText.endsWith('\n')) currentText += '\n'
      } else {
        for (const child of node.childNodes) walk(child)
      }
    }

    for (const child of el.childNodes) walk(child)
    flush()

    return { blocks }
  }, [])

  // 发送消息
  const send = async () => {
    const { blocks } = extractBlocks()
    if (blocks.length === 0 || loading) return

    // 清空输入框
    if (inputRef.current) inputRef.current.innerHTML = ''

    // 组装显示内容
    const textParts = blocks.filter(b => b.type === 'text').map(b => b.content)
    const imgParts = blocks.filter(b => b.type === 'image').map(b => `![](${b.content})`)
    const fileParts = blocks.filter(b => b.type === 'file').map(b => `[file](${b.content})`)
    const content = [...textParts, ...imgParts, ...fileParts].join('\n')

    const msgAttachments: Attachment[] = blocks
      .filter(b => b.type === 'image' || b.type === 'file')
      .map(b => ({ name: '', path: b.content, type: b.type as 'image' | 'file' }))

    setMessages(prev => [...prev, { role: 'user', content, attachments: msgAttachments }])
    setLoading(true)

    try {
      const session = localStorage.getItem('chat-session') || `web-${Math.random().toString(36).slice(2, 10)}`
      if (!localStorage.getItem('chat-session')) localStorage.setItem('chat-session', session)

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks,
          session,
          context_path: location.pathname,
        }),
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      if (reader) {
        setMessages(prev => [...prev, { role: 'bot', content: '' }])
        let buf = ''
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
                  next[next.length - 1] = { role: 'bot', content: fullText }
                  return next
                })
              } else if (ev.type === 'tool' && ev.content) {
                setToolHint(ev.content)
              } else if (ev.type === 'file') {
                setToolHint('')
                if (ev.is_image) {
                  fullText += `\n![${ev.name}](${ev.url})\n`
                } else {
                  fullText += `\n[📎 ${ev.name}](${ev.url})\n`
                }
                setMessages(prev => {
                  const next = [...prev]
                  next[next.length - 1] = { role: 'bot', content: fullText }
                  return next
                })
              } else if (ev.type === 'done') {
                setToolHint('')
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'bot', content: `请求失败: ${e}` }])
    } finally {
      setLoading(false)
      setToolHint('')
    }
  }

  // 拖拽上传
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const files = e.dataTransfer.files
    if (!files || files.length === 0 || !inputRef.current) return
    for (let i = 0; i < files.length; i++) {
      const att = await uploadFile(files[i])
      if (att) {
        if (att.type === 'image') {
          const img = document.createElement('img')
          img.src = att.path
          img.setAttribute('data-path', att.path)
          img.setAttribute('data-name', att.name)
          img.style.cssText = 'max-width:120px;max-height:80px;border-radius:6px;margin:2px;vertical-align:middle;'
          inputRef.current.appendChild(img)
        } else {
          const span = document.createElement('span')
          span.className = 'file-tag'
          span.contentEditable = 'false'
          span.setAttribute('data-path', att.path)
          span.setAttribute('data-name', att.name)
          span.textContent = `📎 ${att.name}`
          inputRef.current.appendChild(span)
          inputRef.current.appendChild(document.createTextNode('\u00A0'))
        }
      }
    }
  }, [uploadFile])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: reducedMotion ? 1 : 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: reducedMotion ? 1 : 0, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            aria-label="打开聊天"
          >
            <ChatCircle size={22} weight="fill" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* 聊天面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: reducedMotion ? 0 : 20, scale: reducedMotion ? 1 : 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : 20, scale: reducedMotion ? 1 : 0.95 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`fixed z-50 bg-[var(--color-bg)] border shadow-2xl flex flex-col
              max-sm:inset-0 max-sm:rounded-none
              sm:bottom-6 sm:right-6 sm:w-[380px] sm:h-[520px] sm:rounded-xl sm:max-h-[80vh]
              ${dragging ? 'border-[var(--color-accent)] border-2' : 'border-[var(--color-border)]'}`}
          >
            {/* 头部 */}
            <div className="h-11 flex items-center justify-between px-4 border-b border-[var(--color-border)] flex-shrink-0">
              <span className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">AI 助手</span>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                aria-label="关闭"
              >
                <X size={14} weight="bold" />
              </button>
            </div>

            {/* 拖拽提示 */}
            {dragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-bg)]/90 rounded-xl">
                <div className="text-sm text-[var(--color-accent)] font-medium">松开上传文件</div>
              </div>
            )}

            {/* 消息区 */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" onClick={handleMessageClick}>
              {messages.length === 0 && (
                <div className="text-center text-xs text-[var(--color-dim)] pt-12">
                  发送消息开始对话
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-end mb-1">
                      {msg.attachments.map((att, j) => (
                        att.type === 'image'
                          ? <img key={j} src={att.path} alt={att.name} className="max-w-[120px] max-h-[80px] rounded object-cover" />
                          : <span key={j} className="text-[11px] bg-[var(--color-surface)] text-[var(--color-muted)] px-2 py-0.5 rounded">📎 {att.name}</span>
                      ))}
                    </div>
                  )}
                  <div
                    className={`text-[13px] leading-relaxed break-words px-3 py-2 rounded-xl
                      ${msg.role === 'user'
                        ? 'ml-auto max-w-[80%] bg-[var(--color-accent)] text-white whitespace-pre-wrap rounded-br-sm'
                        : 'mr-auto max-w-[90%] bg-[var(--color-surface)] text-[var(--color-fg)] border border-[var(--color-border)] chat-markdown rounded-bl-sm'
                      }`}
                  >
                    {msg.role === 'bot' ? (
                      msg.content
                        ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                        : (loading && i === messages.length - 1
                          ? <span className="thinking-dots">思考中</span>
                          : '')
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: renderUserMessage(msg.content) }} />
                    )}
                  </div>
                  {msg.role === 'bot' && loading && i === messages.length - 1 && toolHint && (
                    <div className="text-[11px] text-[var(--color-dim)] mt-1 ml-1 flex items-center gap-1">
                      <span className="animate-spin inline-block w-3 h-3 border border-[var(--color-dim)] border-t-transparent rounded-full"></span>
                      {toolHint}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEnd} />
            </div>

            {/* 输入区 */}
            <div className="border-t border-[var(--color-border)] p-2">
              <div className="flex items-end gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
                  aria-label="上传文件"
                >
                  <Paperclip size={15} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div
                  ref={inputRef}
                  contentEditable
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  data-placeholder="输入消息，粘贴图片或拖拽文件"
                  className="flex-1 min-h-[36px] max-h-[120px] overflow-y-auto px-3 py-2
                    bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg
                    text-[var(--color-fg)] text-[13px] leading-snug
                    focus:outline-none focus:border-[var(--color-accent)]
                    transition-colors break-words"
                  style={{ wordBreak: 'break-word' }}
                />
                <button
                  onClick={send}
                  disabled={loading}
                  className="w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white
                    flex items-center justify-center flex-shrink-0
                    disabled:opacity-30 disabled:cursor-not-allowed
                    hover:brightness-110 active:scale-[0.92]
                    transition-all cursor-pointer"
                  aria-label="发送"
                >
                  <PaperPlaneRight size={14} weight="bold" />
                </button>
              </div>
            </div>

            {/* 复制成功提示 */}
            {copiedIdx !== null && (
              <div className="absolute top-14 right-4 z-50 flex items-center gap-1 bg-green-600 text-white text-xs px-3 py-1.5 rounded-md shadow-lg">
                <Check size={12} weight="bold" /> 已复制
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
