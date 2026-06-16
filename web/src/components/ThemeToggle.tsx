import { useState, useEffect } from 'react'
import { Sun, Moon } from '@phosphor-icons/react'

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem('theme')
    if (stored) return stored
    // 默认跟随系统，暗色优先
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggle = () => {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }

  return (
    <button
      onClick={toggle}
      className="fixed top-3 right-3 sm:top-4 sm:right-4 z-50
        w-9 h-9 rounded-lg
        border border-[var(--color-border)] bg-[var(--color-surface)]
        flex items-center justify-center text-[var(--color-muted)]
        hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]
        active:scale-[0.95] transition-all cursor-pointer"
      aria-label="切换主题"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
