'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { VisualImage } from './visual-effects'
import type { Project } from '../../lib/inspiration'
import { Icon } from '../ui'

export function ProjectCard({ project: p, saved, followed, onSave, compact = false, index = 0 }: { project: Project; saved: boolean; followed: boolean; onSave: () => void; compact?: boolean; index?: number }) {
  const previous = useRef(saved)
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    if (previous.current === saved) return
    previous.current = saved; setConfirmed(true)
    const timer = setTimeout(() => setConfirmed(false), 280)
    return () => clearTimeout(timer)
  }, [saved])
  const count = p.supporters + (followed ? 1 : 0)
  return <article style={{ '--card-delay': `${index < 8 ? index * 35 : 0}ms` } as CSSProperties} data-confirmed={confirmed} className={`ip-project-card ${compact ? 'compact' : ''}`}>
    <div className="ip-card-image"><a href={`#project/${p.id}`} tabIndex={-1} aria-hidden="true"><VisualImage src={p.image} alt="" loading="lazy" /></a><span className="ip-stage">{p.stage}</span><button className={`ip-save ${saved ? 'is-saved' : ''}`} onClick={onSave} aria-label={`${saved ? '取消收藏' : '收藏'} ${p.name}`} aria-pressed={saved}><Icon name={saved ? 'check' : 'bookmark'} size={16} /></button></div>
    <div className="ip-card-content"><div className="ip-card-category">{p.category}<span>·</span>{p.city}</div><h3><a href={`#project/${p.id}`}>{p.name}<span>{p.tagline}</span></a></h3><p className="ip-card-creator">by <a href={`#creator/${encodeURIComponent(p.creator)}`}>{p.creator}</a></p><div className="ip-progress" aria-label={`关注意向 ${count} / ${p.goal}`}><span style={{width:`${Math.min(100,count / p.goal * 100)}%`}} /></div><div className="ip-card-meta"><span><strong>{count.toLocaleString()}</strong> 人感兴趣</span><span>{p.demo ? '示例项目' : '本地发布'}</span></div></div>
  </article>
}
