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
  const visibleSegments = shouldCollapse
    ? [...segments.slice(0, 1), '...', ...segments.slice(-2)]
    : segments

  // 计算每段对应的实际路径
  const getPath = (displayIdx: number) => {
    if (!shouldCollapse) return segments.slice(0, displayIdx + 1).join('/')
    if (displayIdx === 0) return segments.slice(0, 1).join('/')
    if (displayIdx === 1) return '' // 省略号不可点击
    const realIdx = segments.length - (visibleSegments.length - 1 - displayIdx)
    return segments.slice(0, realIdx + 1).join('/')
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

      {visibleSegments.map((seg, i) => {
        const path = getPath(i)
        const isLast = i === visibleSegments.length - 1
        const isEllipsis = seg === '...'

        return (
          <span key={`${seg}-${i}`} className="flex items-center gap-1 min-w-0">
            <CaretRight size={10} className="text-[var(--color-dim)] flex-shrink-0" />
            {isEllipsis ? (
              <span className="text-xs text-[var(--color-dim)]">…</span>
            ) : isLast ? (
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
