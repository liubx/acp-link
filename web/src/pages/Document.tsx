import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Document({ content }: { content: string }) {
  return (
    <div className="max-w-[680px] mx-auto px-4 sm:px-5 pb-24">
      <article className="prose prose-zinc dark:prose-invert max-w-none
        prose-headings:font-semibold
        prose-h1:text-2xl prose-h1:font-bold
        prose-h2:text-xl
        prose-h3:text-base
        prose-p:leading-relaxed
        prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline
        prose-code:text-cyan-700 prose-code:dark:text-cyan-300 prose-code:bg-zinc-100 prose-code:dark:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-lg prose-code:text-sm prose-code:font-[family-name:Geist_Mono]
        prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-900 prose-pre:rounded-lg prose-pre:font-[family-name:Geist_Mono]
        prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-accent)] prose-blockquote:bg-[var(--color-accent-dim)] prose-blockquote:rounded-r-lg prose-blockquote:py-1
        prose-table:text-sm
        prose-thead:border-b prose-thead:border-[var(--color-border)]
        prose-th:font-semibold prose-th:text-[var(--color-muted)] prose-th:py-2
        prose-tr:border-b prose-tr:border-[var(--color-border)]
        prose-td:py-2
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
