import { useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Copy, Check } from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FileInfo } from '../App'

function getExtension(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'makefile' || lower === 'dockerfile') return lower
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot + 1) : ''
}

/** 解析 frontmatter，返回 { meta, body } */
function parseFrontmatter(content: string): { meta: Record<string, string> | null; body: string } {
  if (!content.startsWith('---')) return { meta: null, body: content }
  const end = content.indexOf('\n---', 3)
  if (end < 0) return { meta: null, body: content }

  const yamlBlock = content.slice(4, end).trim()
  const body = content.slice(end + 4).trim()

  // 简单解析 YAML key: value（支持列表合并为逗号分隔）
  const meta: Record<string, string> = {}
  let currentKey = ''
  for (const line of yamlBlock.split('\n')) {
    const kvMatch = line.match(/^(\w[\w\s]*?):\s*(.*)$/)
    if (kvMatch) {
      currentKey = kvMatch[1].trim()
      const val = kvMatch[2].trim()
      if (val) meta[currentKey] = val
    } else if (currentKey && line.match(/^\s+-\s+(.+)/)) {
      const item = line.match(/^\s+-\s+(.+)/)![1].trim()
      meta[currentKey] = meta[currentKey] ? `${meta[currentKey]}, ${item}` : item
    }
  }

  return { meta: Object.keys(meta).length > 0 ? meta : null, body }
}

interface Props {
  fileInfo: FileInfo | null
}

export function FileViewer({ fileInfo }: Props) {
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
  const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'])
  const isImage = isBinary && imageExts.has(ext.toLowerCase())
  const isPdf = isBinary && ext.toLowerCase() === 'pdf'
  const audioExts = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'])
  const isAudio = isBinary && audioExts.has(ext.toLowerCase())
  const videoExts = new Set(['mp4', 'webm', 'mov'])
  const isVideo = isBinary && videoExts.has(ext.toLowerCase())

  return (
    <motion.div
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="max-w-3xl mx-auto px-4 sm:px-6 py-4"
    >
      {/* 文件名 */}
      <h1 className="text-lg font-mono font-semibold text-[var(--color-fg)] mb-4">
        {fileName}
      </h1>

      {/* 内容区 */}
      {isBinary ? (
        isImage ? (
          <div className="text-center">
            <img
              src={`/${fileInfo.path.split('/').map(s => encodeURIComponent(s)).join('/')}`}
              alt={fileName}
              className="max-w-full rounded-lg border border-[var(--color-border)] inline-block"
            />
          </div>
        ) : isPdf ? (
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
            <embed
              src={`/${fileInfo.path.split('/').map(s => encodeURIComponent(s)).join('/')}`}
              type="application/pdf"
              className="w-full rounded-lg"
              style={{ height: 'calc(100vh - 10rem)' }}
            />
          </div>
        ) : isAudio ? (
          <div className="flex items-center justify-center py-12">
            <audio
              controls
              src={`/${fileInfo.path.split('/').map(s => encodeURIComponent(s)).join('/')}`}
              className="w-full max-w-md"
            >
              浏览器不支持音频播放
            </audio>
          </div>
        ) : isVideo ? (
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-black">
            <video
              controls
              src={`/${fileInfo.path.split('/').map(s => encodeURIComponent(s)).join('/')}`}
              className="w-full"
              style={{ maxHeight: 'calc(100vh - 10rem)' }}
            >
              浏览器不支持视频播放
            </video>
          </div>
        ) : (
          <div className="py-12 text-center text-[var(--color-dim)] border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
            <p className="text-sm">无法预览二进制文件</p>
            {fileInfo.size && <p className="text-xs mt-1">大小: {fileInfo.size}</p>}
          </div>
        )
      ) : isMarkdown && fileInfo.content ? (
        <MarkdownContent content={fileInfo.content} filePath={fileInfo.path} />
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

// Markdown 渲染组件（含 frontmatter 属性卡片）
function MarkdownContent({ content, filePath }: { content: string; filePath: string }) {
  const { meta, body } = useMemo(() => parseFrontmatter(content), [content])

  return (
    <article className="markdown-body">
      {meta && (
        <div className="not-prose mb-6 border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
          <div className="px-4 py-2 border-b border-[var(--color-border)]">
            <span className="text-[10px] text-[var(--color-dim)] font-mono uppercase tracking-wider">Properties</span>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {Object.entries(meta).map(([key, value]) => (
              <div key={key} className="flex px-4 py-2 gap-4">
                <span className="text-xs text-[var(--color-dim)] w-20 flex-shrink-0 font-mono">{key}</span>
                <span className="text-sm text-[var(--color-fg)] flex-1">
                  {key === 'tags' ? (
                    <span className="flex flex-wrap gap-1.5">
                      {value.split(',').map(tag => (
                        <span key={tag.trim()} className="inline-block px-2 py-0.5 text-[11px] rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)]">
                          {tag.trim()}
                        </span>
                      ))}
                    </span>
                  ) : value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => {
          if (url.startsWith('http') || url.startsWith('//') || url.startsWith('data:')) return url
          const dir = filePath.split('/').slice(0, -1).join('/')
          if (url.startsWith('/')) return url
          const parts = dir ? dir.split('/') : []
          for (const seg of url.split('/')) {
            if (seg === '..') parts.pop()
            else if (seg !== '.' && seg !== '') parts.push(seg)
          }
          return '/' + parts.join('/')
        }}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const isBlock = String(children).includes('\n') || match
            if (isBlock) {
              const lang = match ? match[1] : ''
              const codeText = String(children).replace(/\n$/, '')
              return (
                <div className="not-prose border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)] my-4">
                  <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                    <span className="text-[10px] text-[var(--color-dim)] font-mono uppercase">{lang || 'code'}</span>
                    <CopyButton text={codeText} />
                  </div>
                  <div className="overflow-x-auto">
                    <pre className="px-4 py-3 text-[13px] leading-relaxed font-mono text-[var(--color-fg)] !bg-transparent !border-0 !m-0 !rounded-none">
                      <code {...props}>{children}</code>
                    </pre>
                  </div>
                </div>
              )
            }
            return <code className={className} {...props}>{children}</code>
          }
        }}
      >
        {body}
      </ReactMarkdown>
    </article>
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
