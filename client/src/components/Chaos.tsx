import { useEffect, useState } from 'react'
import type { ChaosModifier } from '../../../shared/protocol'
import './Chaos.css'

export const CHAOS_COPY: Record<ChaosModifier, { title: string; note: string }> = {
  mirror: { title: 'MIRROR MODE', note: 'the ink lands flipped — steer backwards' },
  memory: { title: 'MEMORY DRAW', note: 'the canvas goes dark 10 seconds in' },
  jitter: { title: 'SHAKY HANDS', note: 'the pen has a mind of its own' },
  simul: { title: 'EVERYBODY DRAWS', note: 'same word, every canvas — the room votes' },
}

/** Full-canvas chaos announcement that shows itself out after a beat. */
export function ChaosBanner({ modifier, roundKey }: { modifier: ChaosModifier; roundKey: number }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2600)
    return () => clearTimeout(t)
  }, [roundKey, modifier])
  if (!visible) return null
  const copy = CHAOS_COPY[modifier]
  return (
    <div className="chaos-banner" role="status">
      <span className="hand-note chaos-banner-kicker">chaos modifier</span>
      <strong className="chaos-banner-title">{copy.title}</strong>
      <span className="chaos-banner-note">{copy.note}</span>
    </div>
  )
}

export function ChaosBadge({ modifier }: { modifier: ChaosModifier }) {
  return (
    <span className="chaos-badge" title={CHAOS_COPY[modifier].note}>
      ⚡ {CHAOS_COPY[modifier].title}
    </span>
  )
}
