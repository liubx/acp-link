interface Props {
  content: string
  ext: string
  lineCount: number
  size: string
}

export function CodeView({ content, ext, lineCount, size }: Props) {
  const lines = content.split('\n')

  return (
    <div className="h-full flex flex-col">
      {/* 元数据栏 */}
      <div className="font-[family-name:Geist_Mono] text-[10px] text-[var(--color-dim)] px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
        {lineCount} lines / {size} / .{ext}
      </div>

      {/* 代码区域 */}
      <div className="flex-1 overflow-auto bg-zinc-950">
        <table className="w-full border-collapse font-[family-name:Geist_Mono] text-[12px] leading-[1.8]">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-white/[0.02]" id={`L${i + 1}`}>
                <td className="w-[1%] min-w-[44px] px-3 text-right text-[11px] text-zinc-600 select-none border-r border-zinc-800/50 align-top sticky left-0 bg-zinc-950">
                  {i + 1}
                </td>
                <td className="px-4 whitespace-pre align-top text-zinc-300">
                  {line || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
