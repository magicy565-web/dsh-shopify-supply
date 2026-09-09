'use client'

import type { AgentEvent } from '@dsh-supply/agent-contracts'
import { useEffect, useRef, useState } from 'react'
import { useMotionVisibility } from './visual-effects'

export const runStatusLabel = (status: string) => ({ idle: '准备就绪', running: '正在执行', waiting_approval: '等待确认', completed: '本轮完成', failed: '执行失败', aborted: '已中断', paused: '已暂停' }[status] || status)

export function AgentRuntime({ status, activity, events }: { status: string; activity: string; events: AgentEvent[] }) {
  const motion = useMotionVisibility<HTMLElement>()
  const last = events.at(-1)
  let roundStart = 0
  events.forEach((e, index) => { if (e.type === 'agent.completed' || e.type === 'agent.failed') roundStart = index + 1 })
  const roundEvents = events.slice(roundStart)
  const finished = new Set(roundEvents.filter(e => e.type === 'tool.completed').map(e => e.toolCallId))
  const activeTools = roundEvents.filter(e => e.type === 'tool.started' && !finished.has(e.toolCallId))
  const running = status === 'running'
  const phase = !running ? -1 : activeTools.length ? 1 : last?.type === 'tool.completed' ? 2 : 0
  return <section ref={motion} className="agent-runtime" data-state={status} aria-label="Agent 运行状态">
    <div className="agent-runtime-top">
      <div className="agent-orbit" aria-hidden="true"><svg viewBox="0 0 64 64"><circle className="agent-orbit-track" cx="32" cy="32" r="27"/><circle className="agent-orbit-path" cx="32" cy="32" r="27"/></svg><span key={status}>{status === 'completed' ? '✓' : status === 'waiting_approval' ? 'Ⅱ' : status === 'failed' ? '!' : status === 'aborted' ? '■' : '✳'}</span></div>
      <div className="agent-runtime-copy" role="status" aria-live="polite"><span className="agent-state-label">{runStatusLabel(status)}</span><h2>{activity || '等待下一步指令'}</h2><p>{status === 'waiting_approval' ? '确认下方操作后，Agent 才会继续。' : status === 'completed' ? '成果已保留，你可以检查结果或继续补充。' : status === 'failed' ? '请查看错误信息，已保存的成果仍可检查。' : status === 'aborted' ? '本轮执行已停止，可补充指令后继续。' : running ? '执行记录会持续更新，成果生成后将在下方显示。' : '描述目标，开始新一轮探索。'}</p></div>
      {running && <span className="agent-equalizer" aria-hidden="true"><i/><i/><i/><i/></span>}
    </div>
    <ol className="agent-loop-phases" aria-label="当前执行环节">{['规划与思考', '调用工具', '整理反馈'].map((label, index) => <li key={label} data-active={phase === index} aria-current={phase === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    {running && activeTools.length > 0 && <div className="agent-active-tools">{activeTools.map(e => e.type === 'tool.started' && <span key={e.toolCallId}><i aria-hidden="true"/>正在调用 · {e.toolName}</span>)}</div>}
  </section>
}

export function AgentEventLog({ events }: { events: AgentEvent[] }) {
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [unread, setUnread] = useState(false)
  const [open, setOpen] = useState(true)
  const rows: Array<{ key: number; text: string; kind: string }> = []
  events.forEach((e, index) => {
    if (e.type === 'message.delta') {
      const previous = rows.at(-1)
      if (previous?.kind === 'message.delta') previous.text += e.text
      else rows.push({ key: index, text: e.text, kind: e.type })
      return
    }
    const text = e.type === 'tool.started' ? `开始调用 · ${e.toolName}` : e.type === 'tool.completed' ? `${e.isError ? '调用失败' : '调用完成'} · ${e.toolName}` : e.type === 'approval.requested' ? `等待确认 · ${e.toolName}` : e.type === 'approval.resolved' ? (e.decision === 'allow' ? '已确认操作' : '已拒绝操作') : e.type === 'agent.failed' ? e.message : '本轮执行结束'
    rows.push({ key: index, text, kind: e.type === 'tool.completed' && e.isError ? 'agent.failed' : e.type })
  })
  const signature = rows.map(row => `${row.kind}:${row.text}`).join('\n')
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    if (following.current && open) { element.scrollTop = element.scrollHeight; setUnread(false) }
    else setUnread(true)
  }, [signature, open])
  return <details className="agent-event-log" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>执行记录 <span>{events.filter(e => e.type === 'tool.completed').length} 次工具调用已返回</span></summary><div ref={viewport} className="agent-event-rows" tabIndex={0} aria-label="可滚动的执行记录" onScroll={event => { const el = event.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32; if (following.current) setUnread(false) }}>{rows.length ? rows.map(row => <p key={row.key} data-kind={row.kind}>{row.text}</p>) : <p className="agent-event-empty">执行开始后，思考输出与工具记录会出现在这里。</p>}</div>{unread && <button className="agent-jump-latest" onClick={() => { following.current = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; setUnread(false) }}>查看最新记录 ↓</button>}</details>
}
