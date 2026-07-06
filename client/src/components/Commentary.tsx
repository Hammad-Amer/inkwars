import './Commentary.css'

/** one deadpan system-log line from THE MACHINE (round-end panels) */
export function MachineQuip({ text }: { text: string }) {
  return (
    <p className="machine-quip">
      <span aria-hidden="true">&gt; </span>
      {text}
    </p>
  )
}

/** the post-match roast block (match-end screens) */
export function MachineAnalysis({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <section className="machine-analysis" aria-label="post-match analysis from the AI">
      <h2 className="machine-analysis-title">Post-match analysis</h2>
      <ul>
        {lines.map((line, i) => (
          <li key={i}>
            <span aria-hidden="true">&gt; </span>
            {line}
          </li>
        ))}
      </ul>
    </section>
  )
}
