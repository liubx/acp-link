import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { FolderSimple, FileText, FileCode, Image, File, CaretLeft, Notebook, ArrowClockwise } from '@phosphor-icons/react'
import type { FileEntry } from '../App'

// 可在 SPA 内预览的文件扩展名
const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'toml', 'rs', 'py', 'js', 'ts',
  'tsx', 'jsx', 'html', 'css', 'scss', 'sh', 'bash', 'zsh', 'fish',
  'go', 'java', 'c', 'cpp', 'h', 'hpp', 'rb', 'php', 'swift', 'kt',
  'lua', 'vim', 'conf', 'ini', 'env', 'xml', 'svg', 'sql', 'graphql',
  'dockerfile', 'makefile', 'gitignore', 'lock',
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  // PDF
  'pdf',
  // 音频
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  // 视频
  'mp4', 'webm', 'mov',
])

// 代码文件扩展名
const CODE_EXTENSIONS = new Set([
  'rs', 'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'lua', 'sh', 'bash',
  'sql', 'graphql',
])

// 图片文件扩展名
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'])

function getExtension(name: string): string {
  const lower = name.toLowerCase()
  // 特殊文件名
  if (lower === 'makefile' || lower === 'dockerfile') return lower
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot + 1) : ''
}

function isTextFile(name: string): boolean {
  const ext = getExtension(name)
  return TEXT_EXTENSIONS.has(ext)
}

function getFileIcon(entry: FileEntry) {
  if (entry.is_dir) {
    return <FolderSimple size={18} weight="fill" className="text-[var(--color-accent)]" />
  }
  const ext = getExtension(entry.name)
  if (IMAGE_EXTENSIONS.has(ext)) {
    return <Image size={18} className="text-[var(--color-muted)]" />
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return <FileCode size={18} className="text-[var(--color-muted)]" />
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return <FileText size={18} className="text-[var(--color-muted)]" />
  }
  return <File size={18} className="text-[var(--color-muted)]" />
}

interface Props {
  entries: FileEntry[]
  currentPath: string
  onNavigate: (path: string, direction: 'forward' | 'back') => void
  onBack?: () => void
  onRefresh?: () => void
}

export function FileList({ entries, currentPath, onNavigate, onBack, onRefresh }: Props) {
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reducedMotion = useReducedMotion()

  // 是否为触摸设备
  const isTouchDevice = typeof window !== 'undefined' && 'ontouchstart' in window

  // 构造完整路径
  const getEntryPath = (name: string) => {
    return currentPath ? `${currentPath}/${name}` : name
  }

  // 排序: 目录在前，然后按名字排序
  const sorted = [...entries].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name)
  })

  // 鼠标进入文件行
  const handleMouseEnter = useCallback((entry: FileEntry, e: React.MouseEvent) => {
    if (isTouchDevice || entry.is_dir || !isTextFile(entry.name)) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPreviewPos({ x: rect.right + 12, y: rect.top })

    hoverTimer.current = setTimeout(async () => {
      try {
        const entryPath = getEntryPath(entry.name)
        const res = await fetch(`/api/files/${encodeURIComponent(entryPath)}`)
        if (res.ok) {
          const data = await res.json()
          if (data.content) {
            const lines = data.content.split('\n').slice(0, 3).join('\n')
            setPreviewContent(lines)
            setPreviewPath(entryPath)
          }
        }
      } catch {
        // 静默失败
      }
    }, 500)
  }, [isTouchDevice])

  // 鼠标离开
  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    setPreviewPath(null)
    setPreviewContent(null)
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
      <div className="flex items-center gap-2 mb-3">
        {onBack && currentPath ? (
          <>
            <button
              onClick={onBack}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
              aria-label="返回"
            >
              <CaretLeft size={18} weight="bold" />
            </button>
            <span className="text-lg font-mono font-semibold text-[var(--color-fg)] flex-1 truncate">
              {currentPath.split('/').pop()}
            </span>
          </>
        ) : (
          <>
            <div className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] flex-shrink-0">
              <Notebook size={18} weight="bold" />
            </div>
            <span className="text-lg font-mono font-semibold text-[var(--color-fg)] flex-1 truncate">
              Notes
            </span>
          </>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
            title="刷新"
          >
            <ArrowClockwise size={14} />
          </button>
        )}
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {sorted.map((entry, idx) => {
          // 目录和文件之间加分组间距
          const prevEntry = idx > 0 ? sorted[idx - 1] : null
          const showGap = prevEntry && prevEntry.is_dir && !entry.is_dir

          return (
            <div key={entry.name}>
              {showGap && <div className="h-2" />}
              <button
            key={entry.name}
            onClick={() => {
              const ext = getExtension(entry.name)
              const canPreview = entry.is_dir || TEXT_EXTENSIONS.has(ext)
              if (canPreview) {
                onNavigate(getEntryPath(entry.name), 'forward')
              } else {
                // 非文本文件直接跳转，让浏览器/服务器处理
                const path = getEntryPath(entry.name)
                const encodedPath = path.split('/').map(s => encodeURIComponent(s)).join('/')
                window.open(`/${encodedPath}`, '_blank')
              }
            }}
            onMouseEnter={(e) => handleMouseEnter(entry, e)}
            onMouseLeave={handleMouseLeave}
            className="w-full flex items-center gap-3 px-3 py-3 sm:py-2.5 text-left hover:bg-[var(--color-surface)] rounded-lg transition-colors cursor-pointer group min-h-[44px]"
          >
            {getFileIcon(entry)}
            <span className="text-sm font-mono text-[var(--color-fg)] group-hover:text-[var(--color-accent)] transition-colors truncate">
              {entry.name}
            </span>
            {entry.is_dir && (
              <span className="ml-auto text-[var(--color-dim)] text-xs">→</span>
            )}
          </button>
            </div>
          )
        })}

        {sorted.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--color-dim)]">
            空目录
          </div>
        )}
      </div>

      {/* 文件预览气泡 */}
      <AnimatePresence>
        {previewPath && previewContent && (
          <motion.div
            initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
            transition={{ duration: reducedMotion ? 0 : 0.15 }}
            className="fixed z-40 max-w-sm pointer-events-none"
            style={{ left: Math.min(previewPos.x, window.innerWidth - 360), top: previewPos.y }}
          >
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl p-3">
              <pre className="text-[11px] leading-relaxed text-[var(--color-muted)] font-mono whitespace-pre-wrap overflow-hidden max-h-[72px]">
                {previewContent}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
