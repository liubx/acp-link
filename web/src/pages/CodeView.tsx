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
      {/* 元信息 */}
      <div className="font-[family-name:Geist_Mono] text-[11px] text-[var(--color-dim)] py-2 mb-2">
        {lineCount} lines / {size} / .{ext}
      </div>

      {/* 代码区域 */}
      <div className="bg-zinc-950 rounded-lg overflow-hidden border border-[var(--color-border)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-[family-name:Geist_Mono] text-[13px] leading-[1.7]">
            <tbody>
              {lines.map((line, i) => (
                <tr
                  key={i}
                  className="hover:bg-zinc-900/60"
                  id={`L${i + 1}`}
                >
                  <td className="w-[1%] min-w-[48px] px-3 sm:px-4 text-right text-[12px] text-zinc-600 select-none border-r border-zinc-800/50 align-top">
                    {i + 1}
                  </td>
                  <td className="px-4 sm:px-5 whitespace-pre align-top text-zinc-300">
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
