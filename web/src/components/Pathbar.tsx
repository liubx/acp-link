import { Link } from 'wouter'
import { House } from '@phosphor-icons/react'

export function Pathbar({ path }: { path: string }) {
  const parts = path.split('/').filter(Boolean)

  return (
    <nav className="font-[family-name:Geist_Mono] text-xs text-[var(--color-muted)] py-3 flex items-center gap-0 overflow-x-auto whitespace-nowrap">
      <Link
        href="/"
        className="text-[var(--color-accent)] p-1.5 -m-1.5 rounded-lg hover:bg-[var(--color-accent-dim)] transition-colors inline-flex items-center"
      >
        <House size={14} weight="fill" />
      </Link>
      {parts.map((part, i) => {
        const href = '/' + parts.slice(0, i + 1).join('/')
        const isLast = i === parts.length - 1
        return (
          <span key={href} className="flex items-center">
            <span className="text-[var(--color-dim)] mx-1">/</span>
            {isLast ? (
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{part}</span>
            ) : (
              <Link
                href={href}
                className="hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] px-1 py-0.5 -mx-1 rounded-lg transition-colors"
              >
                {part}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
