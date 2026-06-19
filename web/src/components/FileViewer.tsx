import { useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Copy, Check, CaretLeft, FileText, FileCode, ImageSquare, FilePdf, MusicNote, VideoCamera, FileHtml } from '@phosphor-icons/react'
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
  onBack?: () => void
}

export function FileViewer({ fileInfo, onBack }: Props) {
  const reducedMotion = useReducedMotion()

  if (!fileInfo) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 text-center text-[var(--color-muted)]">
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
  const isHtml = isCode && (ext === 'html' || ext === 'htm')

  // 根据文件类型选择图标
  const TypeIcon = isMarkdown ? FileText
    : isHtml ? FileHtml
    : isImage ? ImageSquare
    : isPdf ? FilePdf
    : isAudio ? MusicNote
    : isVideo ? VideoCamera
    : isCode ? FileCode
    : FileText

  return (
    <motion.div
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="max-w-5xl mx-auto px-4 sm:px-6 py-4"
    >
      {/* 文件名 */}
      <div className="flex items-center gap-2 mb-4">
        {onBack && (
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex-shrink-0"
            aria-label="返回"
          >
            <CaretLeft size={18} weight="bold" />
          </button>
        )}
        <TypeIcon size={18} className="text-[var(--color-muted)] flex-shrink-0" />
        <h1 className="text-lg font-mono font-semibold text-[var(--color-fg)]">
          {fileName}
        </h1>
      </div>

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
      ) : isCode && fileInfo.content && isHtml ? (
        <HtmlViewer content={fileInfo.content} />
      ) : isCode && fileInfo.content ? (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
          <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-dim)] font-mono uppercase">{ext}</span>
            <CopyButton text={fileInfo.content} />
          </div>
          <div className="overflow-x-auto">
            <pre className="px-0 py-3 text-[13px] leading-relaxed font-mono">
              <code>{fileInfo.content.split('\n').map((line, i) => (
                <div key={i} className="flex hover:bg-[var(--color-bg)] transition-colors">
                  <span className="select-none text-[var(--color-dim)] text-right w-10 pr-4 flex-shrink-0">{i + 1}</span>
                  <span className="text-[var(--color-fg)] flex-1">{line || ' '}</span>
                </div>
              ))}</code>
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

// HTML 预览/代码切换组件
function HtmlViewer({ content }: { content: string }) {
  const [mode, setMode] = useState<'preview' | 'code'>('preview')

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-1 bg-[var(--color-bg)] rounded-md p-0.5 border border-[var(--color-border)]">
          <button
            onClick={() => setMode('preview')}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors cursor-pointer ${
              mode === 'preview'
                ? 'bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm'
                : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            预览
          </button>
          <button
            onClick={() => setMode('code')}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors cursor-pointer ${
              mode === 'code'
                ? 'bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm'
                : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            代码
          </button>
        </div>
        <CopyButton text={content} />
      </div>
      {mode === 'preview' ? (
        <iframe
          srcDoc={content}
          className="w-full bg-white"
          style={{ height: 'calc(100vh - 14rem)', border: 'none' }}
          sandbox="allow-scripts allow-same-origin"
          title="HTML 预览"
        />
      ) : (
        <div className="overflow-x-auto bg-[var(--color-surface)]">
          <pre className="px-4 py-3 text-[13px] leading-relaxed font-mono text-[var(--color-fg)]">
            <code>{addLineNumbers(content)}</code>
          </pre>
        </div>
      )}
    </div>
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
