import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Document({ content }: { content: string }) {
  return (
    <div className="max-w-[680px] mx-auto px-6 sm:px-8 py-8">
      <article className="prose prose-zinc dark:prose-invert max-w-none text-sm
        prose-headings:font-semibold
        prose-h1:text-xl prose-h1:font-bold prose-h1:border-b prose-h1:border-[var(--color-border)] prose-h1:pb-2
        prose-h2:text-lg prose-h2:border-b prose-h2:border-[var(--color-border)] prose-h2:pb-1.5
        prose-h3:text-base
        prose-p:leading-relaxed
        prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline
        prose-code:text-cyan-600 prose-code:dark:text-cyan-300 prose-code:bg-zinc-100 prose-code:dark:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px] prose-code:font-[family-name:Geist_Mono]
        prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-900 prose-pre:rounded-lg prose-pre:text-[12px] prose-pre:font-[family-name:Geist_Mono]
        prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-accent)] prose-blockquote:bg-[var(--color-accent-dim)] prose-blockquote:rounded-r-lg prose-blockquote:py-0.5
        prose-table:text-[12px]
        prose-th:font-semibold prose-th:text-[var(--color-muted)] prose-th:border-b prose-th:border-[var(--color-border)]
        prose-td:border-b prose-td:border-[var(--color-border)] prose-td:py-1.5
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
