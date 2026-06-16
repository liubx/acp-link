import { useState, useRef, useEffect } from 'react'
import { PaperPlaneRight, X } from '@phosphor-icons/react'

interface Message {
  role: 'user' | 'bot'
  content: string
}

interface Props {
  onClose: () => void
}

export function ChatPanel({ onClose }: Props) {
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
    // 聚焦输入框
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  // 保存历史
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('chat-history', JSON.stringify(messages.slice(-30)))
    }
  }, [messages])

  // 滚动到底部（无动画）
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const session = localStorage.getItem('chat-session') || `web-${Math.random().toString(36).slice(2, 10)}`
      if (!localStorage.getItem('chat-session')) localStorage.setItem('chat-session', session)

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [{ type: 'text', content: text }],
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
    <aside className="w-80 lg:w-96 border-l border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col flex-shrink-0
      fixed inset-0 sm:relative sm:inset-auto z-40">
      {/* 头部 */}
      <div className="h-11 flex items-center justify-between px-3 border-b border-[var(--color-border)] flex-shrink-0">
        <span className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">AI 助手</span>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
          aria-label="关闭"
        >
          <X size={14} weight="bold" />
        </button>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-xs text-[var(--color-dim)] pt-12">
            发送消息开始对话
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-[13px] leading-relaxed whitespace-pre-wrap break-words px-3 py-2 rounded-lg
              ${msg.role === 'user'
                ? 'ml-auto max-w-[80%] bg-[var(--color-accent)] text-zinc-950'
                : 'mr-auto max-w-[90%] bg-[var(--color-surface)] text-[var(--color-fg)]'
              }`}
          >
            {msg.content || (loading && i === messages.length - 1 ? '...' : '')}
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      {/* 输入区 */}
      <div className="border-t border-[var(--color-border)] p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={e => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 120) + 'px'
            }}
            placeholder="输入消息..."
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
            disabled={!input.trim() || loading}
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
    </aside>
  )
}
