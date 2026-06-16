import { Link } from 'wouter'

interface Entry {
  name: string
  is_dir: boolean
  ext: string
}

const typeColors: Record<string, string> = {
  dir: 'bg-yellow-400',
  md: 'bg-cyan-400',
  json: 'bg-emerald-400',
  yaml: 'bg-emerald-400',
  yml: 'bg-emerald-400',
  toml: 'bg-emerald-400',
  rs: 'bg-pink-400',
  py: 'bg-pink-400',
  js: 'bg-pink-400',
  ts: 'bg-pink-400',
  go: 'bg-pink-400',
  png: 'bg-violet-400',
  jpg: 'bg-violet-400',
  svg: 'bg-violet-400',
}

function getColor(entry: Entry): string {
  if (entry.is_dir) return typeColors.dir
  return typeColors[entry.ext] || 'bg-zinc-500 opacity-50'
}

export function Directory({ entries, basePath }: { entries: Entry[]; basePath: string }) {
  // 确保 basePath 以 / 结尾
  const base = basePath.endsWith('/') ? basePath : basePath + '/'
  return (
    <div className="max-w-[600px] mx-auto px-4 sm:px-5 pb-24">
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
        {entries.map((entry) => (
          <Link
            key={entry.name}
            href={entry.is_dir ? `${base}${entry.name}/` : `${base}${entry.name}`}
            className="flex items-center gap-3 px-4 py-3 min-h-[48px] sm:min-h-[40px]
              border-b border-[var(--color-border)] last:border-b-0
              hover:bg-[var(--color-bg)] active:scale-[.995]
              transition-all group cursor-pointer"
          >
            {/* 类型色块 */}
            <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${getColor(entry)}`} />
            {/* 文件名 */}
            <span className={`text-sm ${entry.is_dir ? 'font-medium' : ''} text-[var(--color-fg)]`}>
              {entry.name}
            </span>
            {/* 目录箭头 */}
            {entry.is_dir && (
              <svg
                className="ml-auto w-4 h-4 text-[var(--color-dim)] opacity-0 group-hover:opacity-100 transition-opacity"
                viewBox="0 0 16 16" fill="currentColor"
              >
                <path d="M6.22 4.22a.75.75 0 011.06 0l3.25 3.25a.75.75 0 010 1.06l-3.25 3.25a.75.75 0 01-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 010-1.06z"/>
              </svg>
            )}
          </Link>
        ))}
        {entries.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">
            空目录
          </div>
        )}
      </div>
    </div>
  )
}
