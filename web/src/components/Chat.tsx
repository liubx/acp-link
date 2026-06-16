import { useState, useRef, useEffect, useCallback } from 'react'
import { ChatCircle, PaperPlaneRight, Paperclip, X } from '@phosphor-icons/react'

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

  // FAB 按钮
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-4 sm:bottom-5 sm:right-5 z-50
          w-[44px] h-[44px] rounded-lg
          bg-[var(--color-accent)] text-zinc-950
          flex items-center justify-center
          shadow-lg shadow-cyan-500/20
          hover:bg-[var(--color-accent-hover)] hover:shadow-xl hover:shadow-cyan-500/30
          active:scale-[0.95] transition-all cursor-pointer"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="打开 AI 助手"
      >
        <ChatCircle size={22} weight="fill" />
      </button>
    )
  }

  // 聊天面板
  return (
    <div className="fixed inset-0 sm:inset-auto sm:bottom-[74px] sm:right-5 z-50
      w-full h-dvh sm:w-[360px] sm:h-[500px]
      sm:max-h-[calc(100vh-100px)]
      bg-[var(--color-bg)]
      sm:border sm:border-[var(--color-border)] sm:rounded-lg
      sm:shadow-2xl
      flex flex-col overflow-hidden"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[var(--color-accent)] flex items-center justify-center text-zinc-950">
            <ChatCircle size={14} weight="fill" />
          </div>
          <span className="font-semibold text-sm">AI 助手</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="w-[44px] h-[44px] rounded-lg flex items-center justify-center text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] active:scale-[0.95] transition-all cursor-pointer"
          aria-label="关闭"
        >
          <X size={18} weight="bold" />
        </button>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] px-3.5 py-2.5 rounded-lg text-[13px] leading-relaxed whitespace-pre-wrap break-words
              ${msg.role === 'user'
                ? 'ml-auto bg-[var(--color-accent)] text-zinc-950'
                : 'mr-auto bg-zinc-100 dark:bg-zinc-800 text-[var(--color-fg)]'
              }`}
          >
            {msg.content || (loading && i === messages.length - 1 ? '...' : '')}
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      {/* 输入区域 */}
      <div className="border-t border-[var(--color-border)] px-3 py-2.5 bg-[var(--color-surface)]"
        style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-end gap-2">
          {/* 附件按钮 */}
          <button
            className="w-[44px] h-[44px] sm:w-9 sm:h-9 rounded-lg border border-[var(--color-border)]
              flex items-center justify-center flex-shrink-0
              text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-accent)]
              transition-colors cursor-pointer"
            aria-label="附件"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 resize-none min-h-[40px] max-h-[120px] px-3 py-2.5
              bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg
              text-[var(--color-fg)] text-[16px] leading-snug
              placeholder:text-[var(--color-dim)]
              focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-dim)]
              transition-colors"
          />
          {/* 发送按钮 */}
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="w-[44px] h-[44px] sm:w-9 sm:h-9 rounded-lg
              bg-[var(--color-accent)] text-zinc-950
              flex items-center justify-center flex-shrink-0
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:bg-[var(--color-accent-hover)] active:scale-[0.95]
              transition-all cursor-pointer"
            aria-label="发送"
          >
            <PaperPlaneRight size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  )
}
