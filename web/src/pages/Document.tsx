import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Document({ content }: { content: string }) {
  return (
    <div className="max-w-[720px] mx-auto px-4 sm:px-5 pb-24">
      <article className="prose prose-invert max-w-none
        prose-headings:border-b prose-headings:border-[var(--color-border)] prose-headings:pb-2
        prose-h1:text-2xl prose-h1:font-bold
        prose-h2:text-xl prose-h2:font-semibold
        prose-h3:text-base prose-h3:font-semibold prose-h3:border-b-0
        prose-p:text-[var(--color-fg)] prose-p:leading-relaxed
        prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline
        prose-code:text-[var(--color-accent)] prose-code:bg-[var(--color-surface)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono
        prose-pre:bg-[var(--color-surface)] prose-pre:border prose-pre:border-[var(--color-border)] prose-pre:rounded-lg
        prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-accent)] prose-blockquote:bg-[var(--color-accent-dim)] prose-blockquote:rounded-r-lg
        prose-table:text-sm
        prose-th:bg-[var(--color-surface)] prose-th:font-semibold prose-th:text-[var(--color-muted)]
        prose-td:border-b prose-td:border-[var(--color-border)]
        prose-img:rounded-lg
        prose-hr:border-[var(--color-border)]
        prose-li:marker:text-[var(--color-dim)]
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </article>
    </div>
  )
}
