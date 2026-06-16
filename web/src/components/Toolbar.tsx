import { List, ChatCircle, Sun, Moon, House } from '@phosphor-icons/react'

interface Props {
  currentPath: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onToggleChat: () => void
  chatOpen: boolean
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onNavigate: (path: string) => void
}

export function Toolbar({
  currentPath,
  sidebarOpen,
  onToggleSidebar,
  onToggleChat,
  chatOpen,
  theme,
  onToggleTheme,
  onNavigate,
}: Props) {
  const parts = currentPath.split('/').filter(Boolean)

  return (
    <header className="h-11 flex items-center gap-1 px-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0 select-none">
      {/* 左侧：侧边栏切换 + 面包屑 */}
      <button
        onClick={onToggleSidebar}
        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer
          ${sidebarOpen ? 'text-[var(--color-fg)] bg-[var(--color-bg)]' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)]'}`}
        aria-label="切换侧边栏"
      >
        <List size={16} weight="bold" />
      </button>

      {/* 面包屑路径 */}
      <nav className="flex items-center gap-0.5 font-[family-name:Geist_Mono] text-[11px] text-[var(--color-muted)] ml-1 overflow-x-auto whitespace-nowrap flex-1">
        <button
          onClick={() => onNavigate('/')}
          className="hover:text-[var(--color-accent)] px-1 py-0.5 rounded transition-colors cursor-pointer"
        >
          <House size={12} weight="fill" />
        </button>
        {parts.map((part, i) => {
          const href = '/' + parts.slice(0, i + 1).join('/')
          const isLast = i === parts.length - 1
          return (
            <span key={href} className="flex items-center">
              <span className="text-[var(--color-dim)] mx-0.5 opacity-40">/</span>
              {isLast ? (
                <span className="text-[var(--color-fg)] font-medium px-1">{part}</span>
              ) : (
                <button
                  onClick={() => onNavigate(href)}
                  className="hover:text-[var(--color-accent)] px-1 py-0.5 rounded transition-colors cursor-pointer"
                >
                  {part}
                </button>
              )}
            </span>
          )
        })}
      </nav>

      {/* 右侧工具按钮 */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onToggleTheme}
          className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)] transition-colors cursor-pointer"
          aria-label="切换主题"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          onClick={onToggleChat}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer
            ${chatOpen ? 'text-[var(--color-accent)] bg-[var(--color-bg)]' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)]'}`}
          aria-label="AI 助手"
        >
          <ChatCircle size={15} weight={chatOpen ? 'fill' : 'regular'} />
        </button>
      </div>
    </header>
  )
}
