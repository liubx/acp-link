interface Props {
  content: string
  ext: string
  lineCount: number
  size: string
}

export function CodeView({ content, ext, lineCount, size }: Props) {
  const lines = content.split('\n')

  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-5 pb-24">
      {/* 元数据 */}
      <div className="font-mono text-[11px] text-[var(--color-dim)] py-2 border-b border-[var(--color-border)] mb-0">
        {lineCount} lines · {size} · .{ext}
      </div>

      {/* 代码区 */}
      <div className="bg-[#1e1e2e] border border-[var(--color-border)] rounded-lg overflow-hidden mt-2">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[13px] leading-[1.7]">
            <tbody>
              {lines.map((line, i) => (
                <tr
                  key={i}
                  className="hover:bg-cyan-500/[.04] group"
                  id={`L${i + 1}`}
                >
                  <td className="w-[1%] min-w-[48px] px-3 sm:px-4 text-right text-[12px] text-[#4a4a5a] select-none border-r border-white/[.04] group-hover:text-[#8a8a9a] align-top">
                    {i + 1}
                  </td>
                  <td className="px-4 sm:px-5 whitespace-pre align-top text-[#d4d4d8]">
                    {line || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
