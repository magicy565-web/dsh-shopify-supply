import type { ReactNode } from 'react'

export type IconName = 'plus' | 'arrow' | 'chevron' | 'close' | 'search' | 'supply' | 'orders' | 'settings' | 'sun' | 'moon' | 'check' | 'bookmark' | 'external' | 'menu' | 'globe' | 'stop' | 'spark' | 'refresh' | 'back' | 'share' | 'edit' | 'trash' | 'copy'
const paths: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  supply: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
  orders: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--surface)" /><circle cx="15" cy="17" r="3" fill="var(--surface)" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-3-7 1.5-1.5M5 19l1.5-1.5M5 5l1.5 1.5M18 18l1.5 1.5" /></>,
  moon: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4V4Z" />,
  external: <><path d="M14 3h7v7m0-7L10 14M10 5H4v15h15v-6" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />,
  spark: <path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" /></>,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></>,
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg> }
export function Presence({ state = 'idle', large = false }: { state?: string; large?: boolean }) { return <span className={`presence ${large ? 'large' : ''} ${state}`} aria-hidden="true"><span /><span /></span> }
export function Brand() { return <span className="brand-mark" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 32 32" fill="none"><path d="m5 11 11-6 11 6-11 6-11-6Zm0 6 11 6 11-6M5 23l11 6 11-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span> }
export function ProductArt({ category, title, image }: { category: string; title: string; image?: string }) {
  const kind = /lamp|light|灯|家居/i.test(`${category} ${title}`) ? 'lamp' : /bag|sleeve|包|配件/i.test(`${category} ${title}`) ? 'bag' : 'bottle'
  return <div className={`product-art ${kind}`}>
    {image ? <img src={image} alt={title} onError={e => { e.currentTarget.style.display = 'none' }} /> : <svg viewBox="0 0 300 220" role="img" aria-label={`${title} · 示意图`}>
      <ellipse cx="150" cy="187" rx="57" ry="9" fill="currentColor" opacity=".08" />
      {kind === 'lamp' ? <><path d="M145 105h12v66h-12z" fill="#ba826b" /><ellipse cx="151" cy="172" rx="37" ry="10" fill="#af7560" /><path d="M78 107c6-52 30-75 73-75s67 23 73 75c-33 15-113 15-146 0Z" fill="#c9947b" /><ellipse cx="151" cy="107" rx="73" ry="11" fill="#e9b799" /><path d="M99 82c8-22 20-32 35-38" fill="none" stroke="#edc2a8" strokeWidth="3" opacity=".7" /></> : kind === 'bag' ? <><path d="m91 70-8 111c35 12 100 12 134 0L207 70Z" fill="#ccba98" /><path d="M115 89V61c0-39 65-39 65 0v28" fill="none" stroke="#af9c79" strokeWidth="12" /><path d="m95 75 5 102m103-103-5 104M116 96h67v59h-67z" fill="none" stroke="#ab9777" strokeWidth="1.3" /><path d="M88 180c39 8 90 8 124 0" fill="none" stroke="#b3a07e" strokeWidth="3" /></> : <><rect x="119" y="64" width="65" height="121" rx="22" fill="#809790" /><path d="M119 86h65v17h-65z" fill="#94a8a0" /><rect x="121" y="46" width="61" height="29" rx="10" fill="#4e6960" /><path d="M132 47V30c0-7 38-7 38 0v17" fill="#657f75" /><path d="M131 117v46" stroke="#bbccc4" strokeWidth="3" strokeLinecap="round" opacity=".8" /><path d="M181 56c37-20 46 24 16 31" stroke="#58746a" strokeWidth="7" fill="none" strokeLinecap="round" /></>}
    </svg>}
  </div>
}
