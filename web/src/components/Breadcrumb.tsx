import { House, CaretRight } from '@phosphor-icons/react'

interface Props {
  currentPath: string
  onNavigate: (path: string, direction: 'forward' | 'back') => void
}

export function Breadcrumb({ currentPath, onNavigate }: Props) {
  const segments = currentPath.split('/').filter(Boolean)

  // 超过 4 段时省略中间部分
  const maxVisible = 4
  const shouldCollapse = segments.length > maxVisible

  // 折叠时：显示第一段 + ... + 最后两段
  const visibleParts: Array<{ label: string; path: string | null }> = []
  if (shouldCollapse) {
    visibleParts.push({ label: segments[0], path: segments.slice(0, 1).join('/') })
    visibleParts.push({ label: '...', path: null })
    for (let i = segments.length - 2; i < segments.length; i++) {
      visibleParts.push({ label: segments[i], path: segments.slice(0, i + 1).join('/') })
    }
  } else {
    segments.forEach((seg, i) => {
      visibleParts.push({ label: seg, path: segments.slice(0, i + 1).join('/') })
    })
  }

  return (
    <nav className="flex items-center gap-1 text-sm overflow-x-auto min-w-0" aria-label="路径导航">
      <button
        onClick={() => onNavigate('', 'back')}
        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
        aria-label="根目录"
      >
        <House size={16} weight="bold" />
      </button>

      {visibleParts.map((part, i) => {
        const isLast = i === visibleParts.length - 1

        return (
          <span key={`${part.label}-${i}`} className="flex items-center gap-1 min-w-0">
            <CaretRight size={10} className="text-[var(--color-dim)] flex-shrink-0" />
            {part.path === null ? (
              <span className="text-xs text-[var(--color-dim)]">…</span>
            ) : isLast ? (
              <span className="font-mono text-xs text-[var(--color-fg)] truncate max-w-[200px]">
                {part.label}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(part.path!, 'back')}
                className="font-mono text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] truncate max-w-[150px] cursor-pointer transition-colors"
              >
                {part.label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
