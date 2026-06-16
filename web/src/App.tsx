import { useLocation } from 'wouter'
import { useState, useEffect } from 'react'
import { Directory } from './pages/Directory'
import { Document } from './pages/Document'
import { CodeView } from './pages/CodeView'
import { Chat } from './components/Chat'
import { ThemeToggle } from './components/ThemeToggle'
import { Pathbar } from './components/Pathbar'

interface FileInfo {
  type: 'directory' | 'markdown' | 'code' | 'binary'
  path: string
  entries?: Array<{ name: string; is_dir: boolean; ext: string }>
  content?: string
  ext?: string
  line_count?: number
  size?: string
}

export function App() {
  const [location] = useLocation()
  const [info, setInfo] = useState<FileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)

    const cleanPath = location === '/' ? '' : location.replace(/\/+$/, '')
    const apiUrl = `/api/files${cleanPath}`

    fetch(apiUrl)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        setInfo(data)
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [location])

  return (
    <>
      <ThemeToggle />
      <div className="min-h-dvh">
        {/* 路径栏 */}
        <div className="max-w-[900px] mx-auto px-4 sm:px-5 pt-12 sm:pt-14">
          <Pathbar path={location} />
        </div>

        {/* 加载骨架屏 */}
        {loading && (
          <div className="max-w-[600px] mx-auto px-4 pt-4">
            <div className="animate-pulse space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 min-h-[44px]">
                  <div className="w-5 h-5 rounded bg-[var(--color-surface)]" />
                  <div className="h-4 rounded bg-[var(--color-surface)] flex-1 max-w-[200px]" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 错误状态 */}
        {!loading && error && (
          <div className="max-w-[600px] mx-auto px-4 pt-16 text-center text-sm text-[var(--color-muted)]">
            加载失败，请检查服务是否运行
          </div>
        )}

        {/* 内容渲染 */}
        {!loading && !error && info && (
          <>
            {info.type === 'directory' && (
              <Directory entries={info.entries || []} basePath={location} />
            )}
            {info.type === 'markdown' && <Document content={info.content || ''} />}
            {info.type === 'code' && (
              <CodeView
                content={info.content || ''}
                ext={info.ext || ''}
                lineCount={info.line_count || 0}
                size={info.size || ''}
              />
            )}
            {info.type === 'binary' && (
              <div className="max-w-[600px] mx-auto px-4 pt-16 text-center text-sm text-[var(--color-muted)]">
                该文件类型不支持预览
              </div>
            )}
          </>
        )}
      </div>
      <Chat />
    </>
  )
}
