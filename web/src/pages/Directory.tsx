import { Link } from 'wouter'
import {
  FolderSimple,
  FileText,
  FileCode,
  Image,
  Gear,
  File,
  CaretRight,
} from '@phosphor-icons/react'

interface Entry {
  name: string
  is_dir: boolean
  ext: string
}

// 根据文件类型选择图标
function EntryIcon({ entry }: { entry: Entry }) {
  const cls = "w-5 h-5 flex-shrink-0 text-[var(--color-muted)]"

  if (entry.is_dir) return <FolderSimple className={cls} weight="fill" />

  switch (entry.ext) {
    case 'md':
    case 'txt':
    case 'log':
      return <FileText className={cls} />
    case 'rs':
    case 'py':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'rb':
    case 'sh':
    case 'css':
    case 'html':
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <FileCode className={cls} />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return <Image className={cls} />
    case 'conf':
    case 'ini':
    case 'env':
      return <Gear className={cls} />
    default:
      return <File className={cls} />
  }
}

export function Directory({ entries, basePath }: { entries: Entry[]; basePath: string }) {
  const base = basePath === '/' ? '' : basePath.replace(/\/+$/, '')

  return (
    <div className="max-w-[600px] mx-auto px-4 sm:px-5 pb-24">
      <div className="rounded-lg border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)]">
        {entries.map((entry) => (
          <Link
            key={entry.name}
            href={`${base}/${entry.name}`}
            className="flex items-center gap-3 px-4 min-h-[44px]
              bg-[var(--color-surface)]
              hover:bg-zinc-100 dark:hover:bg-zinc-800/50
              active:scale-[0.98]
              transition-all group cursor-pointer"
          >
            <EntryIcon entry={entry} />
            <span className={`text-sm text-[var(--color-fg)] ${entry.is_dir ? 'font-medium' : ''}`}>
              {entry.name}
            </span>
            {entry.is_dir && (
              <CaretRight
                className="ml-auto w-4 h-4 text-[var(--color-dim)] opacity-0 group-hover:opacity-100 transition-opacity"
                weight="bold"
              />
            )}
          </Link>
        ))}
        {entries.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-muted)] bg-[var(--color-surface)]">
            空目录
          </div>
        )}
      </div>
    </div>
  )
}
