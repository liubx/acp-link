import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ChatCircle, PaperPlaneRight, X, Paperclip, Check } from '@phosphor-icons/react'

// --- Markdown 渲染 ---

function renderMarkdown(text: string): string {
  const codeBlocks: string[] = []
  let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length
    const escaped = escapeHtml(code.trimEnd())
    codeBlocks.push(
      `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-btn" data-code="${encodeURIComponent(code.trimEnd())}">复制</button></div><pre><code>${escaped}</code></pre></div>`
    )
    return `\x00CODEBLOCK_${idx}\x00`
  })

  processed = processed.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
  processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="chat-img" />')
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="chat-link">$1</a>')
  processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>')

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

  // 列表
  const lines = processed.split('\n')
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'
  const result: string[] = []

  for (const line of lines) {
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/)
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/)

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
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>')
        inList = false
      }
      result.push(line)
    }
  }
  if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>')

  processed = result.join('\n')
  processed = processed.replace(/\n/g, '<br/>')

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
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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
      return { name: data.name || file.name, path: data.path, type: isImage ? 'image' : 'file' }
    } catch {
      return null
    }
  }, [])

  // 粘贴事件
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const att = await uploadFile(file)
        if (att) setAttachments(prev => [...prev, att])
        return
      }
    }
  }, [uploadFile])

  // 文件选择
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const att = await uploadFile(files[i])
      if (att) setAttachments(prev => [...prev, att])
    }
    e.target.value = ''
  }, [uploadFile])

  // 移除附件
  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

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

  // 发送消息
  const send = async () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || loading) return

    const currentAttachments = [...attachments]
    setInput('')
    setAttachments([])

    let content = text
    if (currentAttachments.length > 0) {
      const attText = currentAttachments.map(a =>
        a.type === 'image' ? `![${a.name}](${a.path})` : `[${a.name}](${a.path})`
      ).join('\n')
      content = content ? `${content}\n${attText}` : attText
    }

    setMessages(prev => [...prev, { role: 'user', content, attachments: currentAttachments }])
    setLoading(true)

    try {
      const session = localStorage.getItem('chat-session') || `web-${Math.random().toString(36).slice(2, 10)}`
      if (!localStorage.getItem('chat-session')) localStorage.setItem('chat-session', session)

      const blocks: { type: string; content: string }[] = []
      if (text) blocks.push({ type: 'text', content: text })
      for (const att of currentAttachments) {
        if (att.type === 'image') {
          blocks.push({ type: 'image', content: att.path })
        } else {
          blocks.push({ type: 'file', content: att.path })
        }
      }

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
                fullText += ev.content
                setMessages(prev => {
                  const next = [...prev]
                  next[next.length - 1] = { role: 'bot', content: fullText }
                  return next
                })
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'bot', content: `请求失败: ${e}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
            className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[var(--color-accent)] text-zinc-950 flex items-center justify-center shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer"
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
            className="fixed z-50 bg-[var(--color-bg)] border border-[var(--color-border)] shadow-2xl flex flex-col
              max-sm:inset-0 max-sm:rounded-none
              sm:bottom-6 sm:right-6 sm:w-[380px] sm:h-[520px] sm:rounded-xl sm:max-h-[80vh]"
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
                    className={`text-[13px] leading-relaxed break-words px-3 py-2 rounded-lg
                      ${msg.role === 'user'
                        ? 'ml-auto max-w-[80%] bg-[var(--color-accent)] text-zinc-950 whitespace-pre-wrap'
                        : 'mr-auto max-w-[90%] bg-[var(--color-surface)] text-[var(--color-fg)] chat-markdown'
                      }`}
                  >
                    {msg.role === 'bot' ? (
                      msg.content
                        ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                        : (loading && i === messages.length - 1 ? <span className="animate-pulse">...</span> : '')
                    ) : (
                      msg.content || ''
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEnd} />
            </div>

            {/* 附件预览 */}
            {attachments.length > 0 && (
              <div className="px-3 py-2 border-t border-[var(--color-border)] flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <div key={i} className="relative group">
                    {att.type === 'image' ? (
                      <img src={att.path} alt={att.name} className="w-12 h-12 rounded object-cover border border-[var(--color-border)]" />
                    ) : (
                      <div className="h-8 px-2 flex items-center gap-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] text-[var(--color-muted)]">
                        📎 <span className="max-w-[80px] truncate">{att.name}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

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
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onInput={e => {
                    const t = e.currentTarget
                    t.style.height = 'auto'
                    t.style.height = Math.min(t.scrollHeight, 120) + 'px'
                  }}
                  placeholder="输入消息... (可粘贴图片)"
                  rows={1}
                  className="flex-1 resize-none min-h-[36px] max-h-[120px] px-3 py-2
                    bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg
                    text-[var(--color-fg)] text-[13px] leading-snug
                    placeholder:text-[var(--color-dim)]
                    focus:outline-none focus:border-[var(--color-accent)]
                    transition-colors"
                />
                <button
                  onClick={send}
                  disabled={(!input.trim() && attachments.length === 0) || loading}
                  className="w-8 h-8 rounded-lg bg-[var(--color-accent)] text-zinc-950
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
