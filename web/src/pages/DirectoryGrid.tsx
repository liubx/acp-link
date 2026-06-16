import { FolderSimple, FileText, FileCode, Image, File } from '@phosphor-icons/react'
import { FileEntry } from '../App'

interface Props {
  entries: FileEntry[]
  currentPath: string
  onNavigate: (path: string) => void
}

function getIcon(entry: FileEntry) {
  if (entry.is_dir) return <FolderSimple size={28} weight="fill" className="text-amber-400" />
  switch (entry.ext) {
    case 'md': case 'txt': case 'log':
      return <FileText size={28} className="text-cyan-400" />
    case 'rs': case 'py': case 'js': case 'ts': case 'tsx': case 'jsx':
    case 'go': case 'java': case 'c': case 'cpp': case 'sh':
    case 'json': case 'yaml': case 'yml': case 'toml': case 'css': case 'html':
      return <FileCode size={28} className="text-pink-400" />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp':
      return <Image size={28} className="text-violet-400" />
    default:
      return <File size={28} className="text-[var(--color-dim)]" />
  }
}

export function DirectoryGrid({ entries, currentPath, onNavigate }: Props) {
  const base = currentPath === '/' ? '' : currentPath.replace(/\/+$/, '')

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-muted)]">
        空目录
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {entries.map(entry => (
          <button
            key={entry.name}
            onClick={() => onNavigate(`${base}/${entry.name}`)}
            className="flex flex-col items-center gap-2 p-3 rounded-lg
              hover:bg-[var(--color-surface)] active:scale-[0.97]
              transition-all cursor-pointer group text-center"
          >
            {getIcon(entry)}
            <span className="text-[11px] leading-tight text-[var(--color-muted)] group-hover:text-[var(--color-fg)] truncate w-full transition-colors">
              {entry.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
