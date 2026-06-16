import { Route, Switch } from 'wouter'
import { Directory } from './pages/Directory'
import { Document } from './pages/Document'
import { CodeView } from './pages/CodeView'
import { Chat } from './components/Chat'
import { ThemeToggle } from './components/ThemeToggle'
import { Pathbar } from './components/Pathbar'

export function App() {
  return (
    <>
      <ThemeToggle />
      <Switch>
        <Route path="/" component={FilePage} />
        <Route path="/:rest*" component={FilePage} />
      </Switch>
      <Chat />
    </>
  )
}

// 根据 API 返回的类型决定渲染哪个页面组件
import { useState, useEffect } from 'react'

interface FileInfo {
  type: 'directory' | 'markdown' | 'code' | 'binary'
  path: string
  // directory
  entries?: Array<{ name: string; is_dir: boolean; ext: string }>
  // markdown / code
  content?: string
  ext?: string
  line_count?: number
  size?: string
}

function FilePage({ params }: { params: { rest?: string } }) {
  const path = '/' + (params.rest || '')
  const [info, setInfo] = useState<FileInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/files${path}`)
      .then(r => r.json())
      .then(data => { setInfo(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [path])

  if (loading) {
    return (
      <div className="max-w-[640px] mx-auto px-4 pt-16">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-[var(--color-surface)] rounded w-1/3" />
          <div className="h-8 bg-[var(--color-surface)] rounded" />
          <div className="h-8 bg-[var(--color-surface)] rounded" />
          <div className="h-8 bg-[var(--color-surface)] rounded" />
        </div>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="max-w-[640px] mx-auto px-4 pt-16 text-center text-[var(--color-muted)]">
        文件不存在
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <div className="max-w-[900px] mx-auto px-4 sm:px-5 pt-12 sm:pt-14">
        <Pathbar path={info.path} />
      </div>
      {info.type === 'directory' && <Directory entries={info.entries || []} basePath={path} />}
      {info.type === 'markdown' && <Document content={info.content || ''} />}
      {info.type === 'code' && (
        <CodeView
          content={info.content || ''}
          ext={info.ext || ''}
          lineCount={info.line_count || 0}
          size={info.size || ''}
        />
      )}
    </div>
  )
}
