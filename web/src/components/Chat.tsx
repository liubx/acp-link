import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  role: 'user' | 'bot'
  content: string
}

export function Chat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
  }, [])

  useEffect(() => {
    if (open) scrollToBottom()
  }, [open, messages, scrollToBottom])

  // 发送消息
  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [{ type: 'text', content: text }],
          session: localStorage.getItem('chat-session') || `web-${Math.random().toString(36).slice(2, 10)}`,
          context_path: location.pathname,
        }),
      })

      if (!localStorage.getItem('chat-session')) {
        localStorage.setItem('chat-session', `web-${Math.random().toString(36).slice(2, 10)}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      if (reader) {
        // 添加空 bot 消息
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

        // 确保最终状态
        if (fullText) {
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { role: 'bot', content: fullText }
            return next
          })
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-4 sm:bottom-5 sm:right-5 z-50
          w-12 h-12 sm:w-11 sm:h-11 rounded-xl
          bg-[var(--color-accent)] text-[var(--color-bg)]
          flex items-center justify-center
          shadow-lg shadow-cyan-500/20
          hover:-translate-y-0.5 hover:shadow-xl hover:shadow-cyan-500/30
          active:scale-90 transition-all cursor-pointer"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="打开 AI 助手"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 sm:inset-auto sm:bottom-[74px] sm:right-5 z-50
      w-full h-dvh sm:w-[360px] sm:h-[500px] lg:w-[380px] lg:h-[540px]
      sm:max-h-[calc(100vh-100px)]
      bg-[var(--color-bg)] sm:bg-[var(--color-bg)]
      sm:border sm:border-[var(--color-border)] sm:rounded-xl
      sm:shadow-2xl sm:animate-in sm:slide-in-from-bottom-2 sm:fade-in
      flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[var(--color-accent)] flex items-center justify-center text-[var(--color-bg)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2a4 4 0 014 4v2a4 4 0 01-8 0V6a4 4 0 014-4z"/><path d="M18 14a6 6 0 00-12 0v4h12v-4z"/>
            </svg>
          </div>
          <span className="font-semibold text-sm">AI 助手</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] active:scale-90 transition-all cursor-pointer"
          aria-label="关闭"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5 scroll-smooth">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap break-words
              ${msg.role === 'user'
                ? 'ml-auto bg-[var(--color-accent)] text-[var(--color-bg)] rounded-br-sm'
                : 'mr-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-bl-sm'
              }`}
          >
            {msg.content || (loading && i === messages.length - 1 ? '...' : '')}
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] px-3 py-2.5 bg-[var(--color-surface)]"
        style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 resize-none min-h-[40px] max-h-[120px] px-3 py-2.5
              bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg
              text-[var(--color-fg)] text-sm sm:text-[13px] leading-snug
              placeholder:text-[var(--color-dim)]
              focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-dim)]
              transition-colors"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg
              bg-[var(--color-accent)] text-[var(--color-bg)]
              flex items-center justify-center flex-shrink-0
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:opacity-85 active:scale-90
              transition-all cursor-pointer"
            aria-label="发送"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
