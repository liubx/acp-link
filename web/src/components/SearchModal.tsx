import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { MagnifyingGlass, FolderSimple, FileText } from '@phosphor-icons/react'

interface SearchResult {
  name: string
  path: string
  is_dir: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  currentPath: string
  onNavigate: (path: string) => void
}

export function SearchModal({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const reducedMotion = useReducedMotion()

  // 打开时重置状态
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    setResults([])
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  // 防抖搜索
  const doSearch = useCallback((q: string) => {
    if (abortRef.current) abortRef.current.abort()
    if (!q.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (!ctrl.signal.aborted) {
          setResults(data.results || [])
          setSelectedIndex(0)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 200)
    return () => clearTimeout(timer)
  }, [query, doSearch])

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      onNavigate(results[selectedIndex].path)
    }
  }

  // 滚动选中项到可见区域
  useEffect(() => {
    const el = document.querySelector(`[data-search-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  // 高亮匹配文字
  function highlightMatch(text: string, q: string): string {
    if (!q.trim()) return text
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark style="background:var(--color-accent-dim);color:var(--color-accent);border-radius:2px;padding:0 1px">$1</mark>')
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.15 }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />

          <motion.div
            className="relative w-full max-w-lg mx-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden"
            initial={{ scale: reducedMotion ? 1 : 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: reducedMotion ? 1 : 0.95, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.15 }}
          >
            <div className="flex items-center gap-3 px-4 h-12 border-b border-[var(--color-border)]">
              <MagnifyingGlass size={18} className="text-[var(--color-muted)] flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="全局搜索文件..."
                className="flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-dim)] outline-none"
              />
              {loading && (
                <div className="w-4 h-4 border-2 border-[var(--color-dim)] border-t-[var(--color-accent)] rounded-full animate-spin" />
              )}
              <kbd className="text-[10px] text-[var(--color-dim)] font-mono px-1.5 py-0.5 rounded border border-[var(--color-border)]">ESC</kbd>
            </div>

            <div className="max-h-[300px] overflow-y-auto py-2">
              {!query.trim() ? (
                <div className="px-4 py-6 text-center text-xs text-[var(--color-dim)]">
                  输入关键词搜索笔记
                </div>
              ) : results.length === 0 && !loading ? (
                <div className="px-4 py-6 text-center text-xs text-[var(--color-dim)]">
                  无匹配结果
                </div>
              ) : (
                results.map((entry, i) => (
                  <button
                    key={entry.path}
                    data-search-index={i}
                    onClick={() => onNavigate(entry.path)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors ${
                      i === selectedIndex
                        ? 'bg-[var(--color-accent-dim)] text-[var(--color-fg)]'
                        : 'text-[var(--color-muted)] hover:bg-[var(--color-accent-dim)]'
                    }`}
                  >
                    {entry.is_dir ? (
                      <FolderSimple size={16} weight="fill" className="text-[var(--color-accent)] flex-shrink-0" />
                    ) : (
                      <FileText size={16} className="flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono truncate block" dangerouslySetInnerHTML={{ __html: highlightMatch(entry.name, query) }} />
                      <span className="text-[11px] text-[var(--color-dim)] truncate block">{entry.path}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
