import { Link } from 'wouter'

export function Pathbar({ path }: { path: string }) {
  const parts = path.split('/').filter(Boolean)

  return (
    <nav className="font-mono text-xs text-[var(--color-muted)] py-3 flex items-center gap-0 overflow-x-auto whitespace-nowrap scrollbar-none">
      <Link
        href="/"
        className="text-[var(--color-accent)] p-1.5 -m-1.5 rounded hover:bg-[var(--color-accent-dim)] transition-colors inline-flex items-center"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 7.5V13a1 1 0 001 1h3a1 1 0 001-1v-2.5h2V13a1 1 0 001 1h3a1 1 0 001-1V7.5a.5.5 0 00.354-.854l-6-6z"/>
        </svg>
      </Link>
      {parts.map((part, i) => {
        const href = '/' + parts.slice(0, i + 1).join('/')
        const isLast = i === parts.length - 1
        return (
          <span key={href} className="flex items-center">
            <span className="text-[var(--color-dim)] mx-0.5">/</span>
            {isLast ? (
              <span className="text-[var(--color-fg)] font-medium">{part}</span>
            ) : (
              <Link
                href={href}
                className="hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] px-1 py-0.5 -mx-1 rounded transition-colors"
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
