import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { FolderSimple, FileText, FileCode, Image, File, CaretLeft, Notebook, ArrowClockwise, Plus, Trash, PencilSimple, FolderPlus, X, Check, UploadSimple } from '@phosphor-icons/react'
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

  // 文件管理状态
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null)
  const [createName, setCreateName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileUploadRef = useRef<HTMLInputElement>(null)

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; name: string } | null>(null)

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

  // --- 文件管理操作 ---
  const handleCreate = async () => {
    if (!createName.trim()) return
    setActionError('')
    const path = getEntryPath(createName.trim())
    try {
      const res = await fetch('/api/fs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, is_dir: creating === 'folder' }),
      })
      if (res.ok) {
        setCreating(null); setCreateName(''); onRefresh?.()
      } else {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || '创建失败')
      }
    } catch { setActionError('网络错误') }
  }

  const handleRename = async (oldName: string) => {
    if (!renameName.trim() || renameName === oldName) { setRenaming(null); return }
    setActionError('')
    const path = getEntryPath(oldName)
    try {
      const res = await fetch('/api/fs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, new_name: renameName.trim() }),
      })
      if (res.ok) {
        setRenaming(null); setRenameName(''); onRefresh?.()
      } else {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || '重命名失败')
      }
    } catch { setActionError('网络错误') }
  }

  const handleDelete = async (name: string) => {
    setActionError('')
    const path = getEntryPath(name)
    try {
      const res = await fetch('/api/fs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (res.ok) {
        setConfirmDelete(null); onRefresh?.()
      } else {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || '删除失败')
      }
    } catch { setActionError('网络错误') }
  }

  // 上传文件到当前目录
  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setActionError('')
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const res = await fetch('/api/fs/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': encodeURIComponent(file.name),
            'X-Dir': encodeURIComponent(currentPath),
          },
          body: file,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setActionError(data.error || `上传 ${file.name} 失败`)
          break
        }
      }
      onRefresh?.()
    } catch { setActionError('上传失败') }
    finally { setUploading(false) }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleUploadFiles(e.target.files)
    e.target.value = ''
  }

  // 拖拽上传
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false) }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files)
    }
  }, [currentPath])

  // 右键菜单：点击其他地方关闭
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const handleContextMenu = useCallback((e: React.MouseEvent, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, name })
  }, [])

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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 relative" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* 拖拽上传遮罩 */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-bg)]/80 border-2 border-dashed border-[var(--color-accent)] rounded-xl"
          >
            <div className="text-center">
              <UploadSimple size={28} className="mx-auto mb-2 text-[var(--color-accent)]" />
              <p className="text-sm text-[var(--color-accent)] font-medium">松开上传文件到此目录</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        <div className="flex items-center gap-1">
          <button
            onClick={() => fileUploadRef.current?.click()}
            disabled={uploading}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0 disabled:opacity-40"
            title="上传文件"
          >
            <UploadSimple size={14} />
          </button>
          <button
            onClick={() => { setCreating('file'); setCreateName(''); setActionError('') }}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
            title="新建文件"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => { setCreating('folder'); setCreateName(''); setActionError('') }}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
            title="新建文件夹"
          >
            <FolderPlus size={14} />
          </button>
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
      </div>
      <input ref={fileUploadRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />

      {/* 新建输入框 */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-2"
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
              {creating === 'folder' ? <FolderSimple size={16} className="text-[var(--color-accent)]" /> : <FileText size={16} className="text-[var(--color-muted)]" />}
              <input
                autoFocus
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(null) }}
                placeholder={creating === 'folder' ? '文件夹名称' : '文件名称'}
                className="flex-1 bg-transparent text-sm text-[var(--color-fg)] outline-none font-mono placeholder:text-[var(--color-dim)]"
              />
              <button onClick={handleCreate} className="text-[var(--color-accent)] hover:text-[var(--color-fg)] p-1 cursor-pointer" title="确认"><Check size={14} weight="bold" /></button>
              <button onClick={() => setCreating(null)} className="text-[var(--color-muted)] hover:text-[var(--color-fg)] p-1 cursor-pointer" title="取消"><X size={14} /></button>
            </div>
            {actionError && <p className="text-[11px] text-red-400 mt-1 px-3">{actionError}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 上传中提示 */}
      {uploading && (
        <div className="flex items-center gap-2 px-3 py-2 mb-2 text-[11px] text-[var(--color-muted)]">
          <span className="chat-spinner" />
          正在上传…
        </div>
      )}

      <div className="divide-y divide-[var(--color-border)]">
        {sorted.map((entry, idx) => {
          // 目录和文件之间加分组间距
          const prevEntry = idx > 0 ? sorted[idx - 1] : null
          const showGap = prevEntry && prevEntry.is_dir && !entry.is_dir

          const isRenaming = renaming === entry.name
          const isDeleting = confirmDelete === entry.name

          return (
            <div key={entry.name}>
              {showGap && <div className="h-2" />}
              {isRenaming ? (
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {getFileIcon(entry)}
                  <input
                    autoFocus
                    value={renameName}
                    onChange={e => setRenameName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(entry.name); if (e.key === 'Escape') setRenaming(null) }}
                    className="flex-1 bg-transparent text-sm text-[var(--color-fg)] outline-none font-mono border-b border-[var(--color-accent)]"
                  />
                  <button onClick={() => handleRename(entry.name)} className="text-[var(--color-accent)] hover:text-[var(--color-fg)] p-1 cursor-pointer"><Check size={14} weight="bold" /></button>
                  <button onClick={() => setRenaming(null)} className="text-[var(--color-muted)] hover:text-[var(--color-fg)] p-1 cursor-pointer"><X size={14} /></button>
                </div>
              ) : isDeleting ? (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/5 rounded-lg">
                  {getFileIcon(entry)}
                  <span className="flex-1 text-sm font-mono text-[var(--color-fg)] truncate">{entry.name}</span>
                  <span className="text-[11px] text-red-400 mr-2">确认删除？</span>
                  <button onClick={() => handleDelete(entry.name)} className="text-red-400 hover:text-red-300 p-1 cursor-pointer" title="确认删除"><Check size={14} weight="bold" /></button>
                  <button onClick={() => setConfirmDelete(null)} className="text-[var(--color-muted)] hover:text-[var(--color-fg)] p-1 cursor-pointer" title="取消"><X size={14} /></button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const ext = getExtension(entry.name)
                    const canPreview = entry.is_dir || TEXT_EXTENSIONS.has(ext)
                    if (canPreview) {
                      onNavigate(getEntryPath(entry.name), 'forward')
                    } else {
                      const path = getEntryPath(entry.name)
                      const encodedPath = path.split('/').map(s => encodeURIComponent(s)).join('/')
                      window.open(`/${encodedPath}`, '_blank')
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, entry.name)}
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
              )}
            </div>
          )
        })}

        {sorted.length === 0 && !creating && (
          <div className="py-12 text-center text-sm text-[var(--color-dim)]">
            空目录
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: reducedMotion ? 0 : 0.1 }}
              className="fixed z-50 min-w-[140px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 overflow-hidden"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => { setRenaming(contextMenu.name); setRenameName(contextMenu.name); setActionError(''); closeContextMenu() }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-fg)] hover:bg-[var(--color-border)] transition-colors cursor-pointer"
              >
                <PencilSimple size={14} /> 重命名
              </button>
              <button
                onClick={() => { setConfirmDelete(contextMenu.name); setActionError(''); closeContextMenu() }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-[var(--color-border)] transition-colors cursor-pointer"
              >
                <Trash size={14} /> 删除
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 错误提示 */}
      {actionError && !creating && (
        <p className="text-[11px] text-red-400 mt-2 px-3">{actionError}</p>
      )}

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
