import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Sun, Moon, CircleHalf, ArrowClockwise, Browser } from '@phosphor-icons/react'
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

export function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window === 'undefined') return ''
    const pathname = decodeURIComponent(window.location.pathname)
    // 去掉 /notes 或 /notes/ 前缀
    return pathname.replace(/^\/notes\/?/, '')
  })
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light' | 'auto'>(() => {
    if (typeof window === 'undefined') return 'auto'
    return (localStorage.getItem('theme') as 'dark' | 'light' | 'auto') || 'auto'
  })
  const reducedMotion = useReducedMotion()

  // 主题应用
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(t => {
      if (t === 'auto') return 'light'
      if (t === 'light') return 'dark'
      return 'auto'
    })
  }

  // 获取文件/目录信息
  const prevPathRef = useRef(currentPath)
  useEffect(() => {
    const isRefresh = prevPathRef.current === currentPath && refreshKey > 0
    prevPathRef.current = currentPath

    // 路径变化时立即清空旧数据，避免闪烁
    if (!isRefresh) setFileInfo(null)

    const fetchData = async () => {
      setLoading(true)
      try {
        const encodedPath = currentPath
          ? '/' + currentPath.split('/').map(s => encodeURIComponent(s)).join('/')
          : ''
        const url = `/api/files${encodedPath}`
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, refreshKey])

  // URL 同步
  useEffect(() => {
    const urlPath = currentPath ? `/notes/${currentPath}` : '/notes'
    if (window.location.pathname !== urlPath) {
      window.history.pushState(null, '', urlPath)
    }
    // 动态更新页面标题
    const name = currentPath ? currentPath.split('/').pop() || 'Notes' : 'Notes'
    document.title = name
  }, [currentPath])

  // 处理浏览器前进/后退
  useEffect(() => {
    const handlePop = () => {
      const pathname = decodeURIComponent(window.location.pathname)
      const path = pathname.replace(/^\/notes\/?/, '')
      setNavDirection('back')
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
  const [navDirection, setNavDirection] = useState<'forward' | 'back'>('forward')
  const navigate = useCallback((path: string, dir: 'forward' | 'back' = 'forward') => {
    setNavDirection(dir)
    setCurrentPath(path)
  }, [])

  // 动画方向
  const isDirectory = fileInfo?.type === 'directory'
  const isFile = fileInfo && fileInfo.type !== 'directory'

  const slideVariants = {
    enter: (dir: string) => ({
      x: reducedMotion ? 0 : dir === 'forward' ? 60 : -60,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (dir: string) => ({
      x: reducedMotion ? 0 : dir === 'forward' ? -60 : 60,
      opacity: 0,
    }),
  }

  const [showProgress, setShowProgress] = useState(false)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 进度条最短显示 400ms
  useEffect(() => {
    if (loading) {
      setShowProgress(true)
      if (progressTimer.current) clearTimeout(progressTimer.current)
    } else {
      progressTimer.current = setTimeout(() => setShowProgress(false), 400)
    }
    return () => { if (progressTimer.current) clearTimeout(progressTimer.current) }
  }, [loading])

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶部进度条 */}
      {showProgress && (
        <div className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-[var(--color-border)] overflow-hidden">
          <div className="h-full bg-[var(--color-accent)] animate-progress" />
        </div>
      )}

      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 bg-[var(--color-bg)]/80 backdrop-blur-md border-b border-[var(--color-border)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <Breadcrumb currentPath={currentPath} onNavigate={navigate} />
          <div className="flex items-center gap-1.5">
            {isFile && fileInfo && (
              <button
                onClick={() => {
                  const encodedPath = fileInfo.path.split('/').map(s => encodeURIComponent(s)).join('/')
                  window.open(`/${encodedPath}`, '_blank')
                }}
                className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                aria-label="打开"
                title="在新标签页打开"
              >
                <Browser size={15} />
              </button>
            )}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
              aria-label="刷新"
              title="刷新"
            >
              <ArrowClockwise size={15} />
            </button>
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
              aria-label="切换主题"
              title={theme === 'dark' ? '暗色' : theme === 'light' ? '亮色' : '跟随系统'}
            >
              {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <CircleHalf size={16} />}
            </button>
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] px-2.5 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] transition-colors cursor-pointer"
              aria-label="搜索"
            >
              <kbd className="font-mono text-[10px]">⌘K</kbd>
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区 - overflow-clip 防止 x 动画撑宽页面 */}
      <main className="flex-1 relative" style={{ overflowX: 'clip' }}>
        <AnimatePresence mode="wait" custom={navDirection}>
          <motion.div
            key={currentPath}
            custom={navDirection}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="w-full"
          >
            {loading && !fileInfo ? (
              <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-11 rounded-lg bg-[var(--color-surface)] animate-pulse" />
                  ))}
                </div>
              </div>
            ) : isFile ? (
              <FileViewer fileInfo={fileInfo} onBack={currentPath ? () => {
                const parent = currentPath.split('/').slice(0, -1).join('/')
                navigate(parent, 'back')
              } : undefined} />
            ) : isDirectory && fileInfo?.entries ? (
              <FileList
                entries={fileInfo.entries}
                currentPath={currentPath}
                onNavigate={navigate}
                onBack={currentPath ? () => {
                  const parent = currentPath.split('/').slice(0, -1).join('/')
                  navigate(parent, 'back')
                } : undefined}
              />
            ) : (
              <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center text-[var(--color-muted)]">
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
        currentPath={currentPath}
        onNavigate={(path) => {
          setSearchOpen(false)
          navigate(path, 'forward')
        }}
      />

      {/* 悬浮聊天按钮 */}
      <ChatFab />
    </div>
  )
}
