import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { MagnifyingGlass, FolderSimple, FileText } from '@phosphor-icons/react'
import type { FileEntry } from '../App'

interface Props {
  open: boolean
  onClose: () => void
  entries: FileEntry[]
  onNavigate: (path: string) => void
}

export function SearchModal({ open, onClose, entries, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const reducedMotion = useReducedMotion()

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // 过滤结果
  const results = useMemo(() => {
    if (!query.trim()) return entries
    const q = query.toLowerCase()
    return entries.filter(e => e.name.toLowerCase().includes(q))
  }, [entries, query])

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0)
  }, [results])

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
      onNavigate(results[selectedIndex].name)
    }
  }

  if (!open) return null

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
          {/* 背景遮罩 */}
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />

          {/* 搜索框 */}
          <motion.div
            className="relative w-full max-w-lg mx-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden"
            initial={{ scale: reducedMotion ? 1 : 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: reducedMotion ? 1 : 0.95, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.15 }}
          >
            {/* 输入区 */}
            <div className="flex items-center gap-3 px-4 h-12 border-b border-[var(--color-border)]">
              <MagnifyingGlass size={18} className="text-[var(--color-muted)] flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="搜索文件..."
                className="flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-dim)] outline-none"
              />
              <kbd className="text-[10px] text-[var(--color-dim)] font-mono px-1.5 py-0.5 rounded border border-[var(--color-border)]">ESC</kbd>
            </div>

            {/* 结果列表 */}
            <div className="max-h-[300px] overflow-y-auto py-2">
              {results.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-[var(--color-dim)]">
                  无匹配结果
                </div>
              ) : (
                results.slice(0, 20).map((entry, i) => (
                  <button
                    key={entry.name}
                    onClick={() => onNavigate(entry.name)}
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
                    <span className="text-sm font-mono truncate">{entry.name}</span>
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
