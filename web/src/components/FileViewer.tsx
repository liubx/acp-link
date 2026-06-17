import { motion, useReducedMotion } from 'motion/react'
import { CaretLeft } from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FileInfo } from '../App'

// 代码文件扩展名
const CODE_EXTENSIONS = new Set([
  'rs', 'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'lua', 'sh', 'bash',
  'sql', 'graphql', 'css', 'scss', 'html', 'xml', 'json', 'yaml',
  'yml', 'toml', 'ini', 'conf', 'dockerfile', 'makefile',
])

function getExtension(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'makefile' || lower === 'dockerfile') return lower
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot + 1) : ''
}

interface Props {
  fileInfo: FileInfo | null
  onBack: () => void
}

export function FileViewer({ fileInfo, onBack }: Props) {
  const reducedMotion = useReducedMotion()

  if (!fileInfo) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center text-[var(--color-muted)]">
        无法加载文件
      </div>
    )
  }

  const ext = getExtension(fileInfo.name)
  const isMarkdown = ext === 'md'
  const isCode = CODE_EXTENSIONS.has(ext)
  const isBinary = fileInfo.is_binary

  return (
    <motion.div
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="max-w-3xl mx-auto px-4 sm:px-6 py-4"
    >
      {/* 返回按钮 */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)] transition-colors cursor-pointer mb-4 min-h-[44px] sm:min-h-0"
      >
        <CaretLeft size={14} weight="bold" />
        <span>返回</span>
      </button>

      {/* 文件名 */}
      <h1 className="text-lg font-mono font-semibold text-[var(--color-fg)] mb-4">
        {fileInfo.name}
      </h1>

      {/* 内容区 */}
      {isBinary ? (
        <div className="py-12 text-center text-[var(--color-dim)] border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
          <p className="text-sm">无法预览二进制文件</p>
          <p className="text-xs mt-1">大小: {formatSize(fileInfo.size ?? 0)}</p>
        </div>
      ) : isMarkdown && fileInfo.content ? (
        <article className="prose prose-invert max-w-none prose-sm prose-headings:text-[var(--color-fg)] prose-p:text-[var(--color-fg)] prose-a:text-[var(--color-accent)] prose-code:text-[var(--color-accent)] prose-pre:bg-[var(--color-surface)] prose-pre:border prose-pre:border-[var(--color-border)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {fileInfo.content}
          </ReactMarkdown>
        </article>
      ) : isCode && fileInfo.content ? (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
          <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-dim)] font-mono uppercase">{ext}</span>
            <CopyButton text={fileInfo.content} />
          </div>
          <div className="overflow-x-auto">
            <pre className="px-4 py-3 text-[13px] leading-relaxed font-mono text-[var(--color-fg)]">
              <code>{addLineNumbers(fileInfo.content)}</code>
            </pre>
          </div>
        </div>
      ) : fileInfo.content ? (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
          <pre className="px-4 py-3 text-sm leading-relaxed font-mono text-[var(--color-fg)] overflow-x-auto whitespace-pre-wrap">
            {fileInfo.content}
          </pre>
        </div>
      ) : (
        <div className="py-12 text-center text-[var(--color-dim)]">
          无内容
        </div>
      )}
    </motion.div>
  )
}

// 行号辅助
function addLineNumbers(content: string): string {
  const lines = content.split('\n')
  const pad = String(lines.length).length
  return lines.map((line, i) => {
    const num = String(i + 1).padStart(pad, ' ')
    return `${num}  ${line}`
  }).join('\n')
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 复制按钮组件
function CopyButton({ text }: { text: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-fg)] px-2 py-1 rounded hover:bg-[var(--color-border)] transition-colors cursor-pointer"
    >
      复制
    </button>
  )
}
