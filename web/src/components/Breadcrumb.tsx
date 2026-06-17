import { House, CaretRight } from '@phosphor-icons/react'

interface Props {
  currentPath: string
  onNavigate: (path: string, direction: 'forward' | 'back') => void
}

export function Breadcrumb({ currentPath, onNavigate }: Props) {
  const segments = currentPath.split('/').filter(Boolean)

  return (
    <nav className="flex items-center gap-1 text-sm overflow-x-auto min-w-0" aria-label="路径导航">
      <button
        onClick={() => onNavigate('', 'back')}
        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
        aria-label="根目录"
      >
        <House size={16} weight="bold" />
      </button>

      {segments.map((seg, i) => {
        const path = segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1

        return (
          <span key={path} className="flex items-center gap-1 min-w-0">
            <CaretRight size={10} className="text-[var(--color-dim)] flex-shrink-0" />
            {isLast ? (
              <span className="font-mono text-xs text-[var(--color-fg)] truncate max-w-[200px]">
                {seg}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(path, 'back')}
                className="font-mono text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] truncate max-w-[150px] cursor-pointer transition-colors"
              >
                {seg}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
