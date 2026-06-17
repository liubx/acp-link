import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CaretLeft, Copy, Check } from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FileInfo } from '../App'

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

  // 从路径中提取文件名
  const fileName = fileInfo.path.split('/').pop() || fileInfo.path
  const ext = fileInfo.ext || getExtension(fileName)
  const isMarkdown = fileInfo.type === 'markdown'
  const isCode = fileInfo.type === 'code'
  const isBinary = fileInfo.type === 'binary'

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
        {fileName}
      </h1>

      {/* 内容区 */}
      {isBinary ? (
        <div className="py-12 text-center text-[var(--color-dim)] border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
          <p className="text-sm">无法预览二进制文件</p>
          {fileInfo.size && <p className="text-xs mt-1">大小: {fileInfo.size}</p>}
        </div>
      ) : isMarkdown && fileInfo.content ? (
        <article className="markdown-body">
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

// 复制按钮组件（兼容 HTTP 非安全上下文）
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    } else {
      // fallback for HTTP
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="text-[var(--color-muted)] hover:text-[var(--color-fg)] p-1.5 rounded hover:bg-[var(--color-border)] transition-colors cursor-pointer"
      aria-label="复制"
    >
      {copied ? <Check size={14} weight="bold" className="text-green-500" /> : <Copy size={14} />}
    </button>
  )
}
