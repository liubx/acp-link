import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { SearchModal } from './components/SearchModal'
import { FileList } from './components/FileList'
import { FileViewer } from './components/FileViewer'
import { ChatFab } from './components/ChatFab'
import { Breadcrumb } from './components/Breadcrumb'

// API 响应类型（匹配后端实际返回格式）
export interface FileEntry {
  name: string
  is_dir: boolean
  ext: string
}

export interface FileInfo {
  type: 'directory' | 'markdown' | 'code' | 'binary'
  path: string
  entries?: FileEntry[]
  content?: string
  ext?: string
  line_count?: number
  size?: string
}

type Direction = 'forward' | 'back'

export function App() {
  const [currentPath, setCurrentPath] = useState('')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [direction, setDirection] = useState<Direction>('forward')
  const [searchOpen, setSearchOpen] = useState(false)
  const reducedMotion = useReducedMotion()

  // 从 URL 初始化路径
  useEffect(() => {
    const path = decodeURIComponent(window.location.pathname.replace(/^\//, ''))
    setCurrentPath(path)
  }, [])

  // 获取文件/目录信息
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const url = currentPath ? `/api/files/${encodeURIComponent(currentPath)}` : '/api/files'
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          setFileInfo(data)
        } else {
          setFileInfo(null)
        }
      } catch {
        setFileInfo(null)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [currentPath])

  // URL 同步
  useEffect(() => {
    const urlPath = currentPath ? `/${currentPath}` : '/'
    if (window.location.pathname !== urlPath) {
      window.history.pushState(null, '', urlPath)
    }
  }, [currentPath])

  // 处理浏览器前进/后退
  useEffect(() => {
    const handlePop = () => {
      const path = decodeURIComponent(window.location.pathname.replace(/^\//, ''))
      setDirection('back')
      setCurrentPath(path)
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  // Cmd+K 快捷键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // 导航函数
  const navigate = useCallback((path: string, dir: Direction = 'forward') => {
    setDirection(dir)
    setCurrentPath(path)
  }, [])

  // 返回上级目录
  const goBack = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    navigate(parts.join('/'), 'back')
  }, [currentPath, navigate])

  // 动画变体
  const variants = {
    enter: (dir: Direction) => ({
      x: reducedMotion ? 0 : dir === 'forward' ? 80 : -80,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (dir: Direction) => ({
      x: reducedMotion ? 0 : dir === 'forward' ? -80 : 80,
      opacity: 0,
    }),
  }

  // 判断当前是目录还是文件
  const isDirectory = fileInfo?.type === 'directory'
  const isFile = fileInfo && fileInfo.type !== 'directory'

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 bg-[var(--color-bg)]/80 backdrop-blur-md border-b border-[var(--color-border)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <Breadcrumb currentPath={currentPath} onNavigate={navigate} />
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] px-2.5 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] transition-colors cursor-pointer"
            aria-label="搜索"
          >
            <kbd className="font-mono text-[10px]">⌘K</kbd>
          </button>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 relative">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentPath + (isFile ? '-file' : '-dir')}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }}
            className="w-full"
          >
            {loading ? (
              <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-11 rounded-lg bg-[var(--color-surface)] animate-pulse" />
                  ))}
                </div>
              </div>
            ) : isFile ? (
              <FileViewer fileInfo={fileInfo} onBack={goBack} />
            ) : isDirectory && fileInfo?.entries ? (
              <FileList
                entries={fileInfo.entries}
                currentPath={currentPath}
                onNavigate={navigate}
              />
            ) : (
              <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 text-center text-[var(--color-muted)]">
                无法加载此路径
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 搜索弹窗 */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        entries={fileInfo?.entries ?? []}
        onNavigate={(name) => {
          setSearchOpen(false)
          const fullPath = currentPath ? `${currentPath}/${name}` : name
          navigate(fullPath, 'forward')
        }}
      />

      {/* 悬浮聊天按钮 */}
      <ChatFab />
    </div>
  )
}
