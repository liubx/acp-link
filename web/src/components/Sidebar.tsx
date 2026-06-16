import { useState, useEffect } from 'react'
import { FolderSimple, File, FileCode, FileText, Image, CaretRight, CaretDown, X } from '@phosphor-icons/react'

interface Props {
  currentPath: string
  onNavigate: (path: string) => void
  onClose?: () => void
}

interface TreeEntry {
  name: string
  is_dir: boolean
  ext: string
  path: string
  children?: TreeEntry[]
  loaded?: boolean
  expanded?: boolean
}

function getIcon(entry: TreeEntry) {
  if (entry.is_dir) return entry.expanded 
    ? <FolderSimple size={15} weight="fill" className="text-amber-400" />
    : <FolderSimple size={15} weight="fill" className="text-[var(--color-muted)]" />
  
  switch (entry.ext) {
    case 'md': case 'txt': case 'log':
      return <FileText size={15} className="text-[var(--color-muted)]" />
    case 'rs': case 'py': case 'js': case 'ts': case 'tsx': case 'jsx':
    case 'go': case 'java': case 'c': case 'cpp': case 'sh':
    case 'json': case 'yaml': case 'yml': case 'toml': case 'css': case 'html':
      return <FileCode size={15} className="text-[var(--color-muted)]" />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp':
      return <Image size={15} className="text-[var(--color-muted)]" />
    default:
      return <File size={15} className="text-[var(--color-muted)]" />
  }
}

function TreeItem({ entry, depth, currentPath, onNavigate, onToggle }: {
  entry: TreeEntry
  depth: number
  currentPath: string
  onNavigate: (path: string) => void
  onToggle: (path: string) => void
}) {
  const isActive = currentPath === entry.path
  const pl = 8 + depth * 16

  return (
    <>
      <button
        onClick={() => {
          if (entry.is_dir) {
            onToggle(entry.path)
          }
          onNavigate(entry.path)
        }}
        className={`w-full flex items-center gap-1.5 py-[5px] pr-2 text-left text-[12px] transition-colors cursor-pointer group
          ${isActive 
            ? 'bg-[var(--color-accent-dim)] text-[var(--color-fg)]' 
            : 'text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)]'
          }`}
        style={{ paddingLeft: `${pl}px` }}
      >
        {entry.is_dir && (
          <span className="w-3 flex items-center justify-center flex-shrink-0">
            {entry.expanded 
              ? <CaretDown size={10} weight="bold" /> 
              : <CaretRight size={10} weight="bold" />
            }
          </span>
        )}
        {!entry.is_dir && <span className="w-3" />}
        {getIcon(entry)}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.is_dir && entry.expanded && entry.children && (
        entry.children.map(child => (
          <TreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            currentPath={currentPath}
            onNavigate={onNavigate}
            onToggle={onToggle}
          />
        ))
      )}
    </>
  )
}

export function Sidebar({ currentPath, onNavigate, onClose }: Props) {
  const [tree, setTree] = useState<TreeEntry[]>([])

  // 加载根目录
  useEffect(() => {
    fetch('/api/files')
      .then(r => r.json())
      .then(data => {
        if (data?.entries) {
          setTree(data.entries.map((e: { name: string; is_dir: boolean; ext: string }) => ({
            ...e,
            path: `/${e.name}`,
            children: undefined,
            loaded: false,
            expanded: false,
          })))
        }
      })
      .catch(() => {})
  }, [])

  // 切换目录展开/折叠
  const toggleDir = async (path: string) => {
    const toggle = (items: TreeEntry[]): TreeEntry[] => {
      return items.map(item => {
        if (item.path === path && item.is_dir) {
          if (!item.loaded) {
            loadChildren(path)
            return { ...item, expanded: true, loaded: true }
          }
          return { ...item, expanded: !item.expanded }
        }
        if (item.children) {
          return { ...item, children: toggle(item.children) }
        }
        return item
      })
    }
    setTree(prev => toggle(prev))
  }

  const loadChildren = async (path: string) => {
    try {
      const cleanPath = path.replace(/\/+$/, '')
      const res = await fetch(`/api/files${cleanPath}`)
      const data = await res.json()
      if (data?.entries) {
        const children: TreeEntry[] = data.entries.map((e: { name: string; is_dir: boolean; ext: string }) => ({
          ...e,
          path: `${path}/${e.name}`,
          children: undefined,
          loaded: false,
          expanded: false,
        }))
        setTree(prev => insertChildren(prev, path, children))
      }
    } catch { /* ignore */ }
  }

  const insertChildren = (items: TreeEntry[], parentPath: string, children: TreeEntry[]): TreeEntry[] => {
    return items.map(item => {
      if (item.path === parentPath) {
        return { ...item, children, loaded: true, expanded: true }
      }
      if (item.children) {
        return { ...item, children: insertChildren(item.children, parentPath, children) }
      }
      return item
    })
  }

  return (
    <aside className="w-56 lg:w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto flex-shrink-0
      max-sm:fixed max-sm:inset-0 max-sm:w-full max-sm:z-50 max-sm:border-r-0
      sm:relative sm:block">
      {/* 移动端关闭按钮 */}
      <div className="h-11 flex items-center justify-between px-3 border-b border-[var(--color-border)] sm:hidden">
        <span className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">文件</span>
        {onClose && (
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)] transition-colors cursor-pointer"
            aria-label="关闭侧边栏"
          >
            <X size={14} weight="bold" />
          </button>
        )}
      </div>

      <div className="py-2">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-xs text-[var(--color-dim)] text-center">
            加载中...
          </div>
        ) : (
          tree.map(entry => (
            <TreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              currentPath={currentPath}
              onNavigate={onNavigate}
              onToggle={toggleDir}
            />
          ))
        )}
      </div>
    </aside>
  )
}
