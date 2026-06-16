import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { ContentView } from './components/ContentView'
import { ChatPanel } from './components/ChatPanel'
import './index.css'

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
  const [currentPath, setCurrentPath] = useState('/')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'light') return 'light'
    return 'dark'
  })

  // 主题切换
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  // 加载文件/目录数据
  const loadPath = useCallback((path: string) => {
    setCurrentPath(path)
    setLoading(true)
    const cleanPath = path === '/' ? '' : path.replace(/\/+$/, '')
    fetch(`/api/files${cleanPath}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setFileInfo(data); setLoading(false) })
      .catch(() => { setFileInfo(null); setLoading(false) })

    // 更新浏览器 URL（不刷新）
    window.history.pushState(null, '', path)
  }, [])

  // 初始加载
  useEffect(() => {
    const path = window.location.pathname || '/'
    setCurrentPath(path)
    loadPath(path)
  }, [loadPath])

  // 浏览器前进/后退
  useEffect(() => {
    const handler = () => {
      const path = window.location.pathname || '/'
      setCurrentPath(path)
      loadPath(path)
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [loadPath])

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* 顶部工具栏 */}
      <Toolbar
        currentPath={currentPath}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
        onToggleChat={() => setChatOpen(c => !c)}
        chatOpen={chatOpen}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onNavigate={loadPath}
      />

      {/* 主体区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 侧边栏文件树 */}
        {sidebarOpen && (
          <Sidebar
            currentPath={currentPath}
            onNavigate={loadPath}
          />
        )}

        {/* 主内容区 */}
        <main className="flex-1 overflow-auto">
          <ContentView
            fileInfo={fileInfo}
            loading={loading}
            onNavigate={loadPath}
            currentPath={currentPath}
          />
        </main>

        {/* 聊天侧边栏 */}
        {chatOpen && (
          <ChatPanel onClose={() => setChatOpen(false)} />
        )}
      </div>
    </div>
  )
}
