import { FileInfo } from '../App'
import { Document } from '../pages/Document'
import { CodeView } from '../pages/CodeView'
import { DirectoryGrid } from '../pages/DirectoryGrid'

interface Props {
  fileInfo: FileInfo | null
  loading: boolean
  onNavigate: (path: string) => void
  currentPath: string
}

export function ContentView({ fileInfo, loading, onNavigate, currentPath }: Props) {
  if (loading) {
    return (
      <div className="p-6 animate-pulse space-y-3 max-w-3xl">
        <div className="h-5 bg-[var(--color-surface)] rounded w-48" />
        <div className="h-4 bg-[var(--color-surface)] rounded w-full max-w-lg" />
        <div className="h-4 bg-[var(--color-surface)] rounded w-full max-w-md" />
        <div className="h-4 bg-[var(--color-surface)] rounded w-full max-w-sm" />
      </div>
    )
  }

  if (!fileInfo) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-muted)]">
        文件不存在
      </div>
    )
  }

  switch (fileInfo.type) {
    case 'directory':
      return (
        <DirectoryGrid
          entries={fileInfo.entries || []}
          currentPath={currentPath}
          onNavigate={onNavigate}
        />
      )
    case 'markdown':
      return <Document content={fileInfo.content || ''} />
    case 'code':
      return (
        <CodeView
          content={fileInfo.content || ''}
          ext={fileInfo.ext || ''}
          lineCount={fileInfo.line_count || 0}
          size={fileInfo.size || ''}
        />
      )
    case 'binary':
      return (
        <div className="flex items-center justify-center h-full text-sm text-[var(--color-muted)]">
          该文件类型不支持在线预览
        </div>
      )
    default:
      return null
  }
}
