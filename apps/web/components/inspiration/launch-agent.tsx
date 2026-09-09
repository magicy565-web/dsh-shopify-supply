'use client'
import { useEffect, useRef, useState } from 'react'
import { TechCore } from './visual-effects'
import { AgentRuntime, AgentEventLog, runStatusLabel } from './agent-runtime'
import type { AgentEvent } from '@dsh-supply/agent-contracts'
import { api, streamMessage } from '../../lib/api'
import type { Campaign } from '../../lib/campaign'
import type { SessionUser } from '../../lib/session'
type Run = { id: string; sessionId: string; goal: string; status: string; activity: string; error: string; campaign: Campaign; events?: AgentEvent[]; stages: Array<{ id: string; title: string; status: string; summary: string; questions: string[]; evidence: Array<{kind:string;text:string;source?:{title:string;url?:string}}> }> }
export function LaunchAgent({ session, onAskLogin }: { session: SessionUser | null; onAskLogin: () => void }) {
  const [runs,setRuns] = useState<Run[]>([]), [selected,setSelected] = useState(''), [goal,setGoal] = useState(''), [reply,setReply] = useState(''), [error,setError] = useState(''), [available,setAvailable] = useState(false), [busy,setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const creating = useRef(false)
  const run = runs.find(r => r.id === selected)
  const refresh = async () => { if (!session) { setRuns([]); return }; const data = await api<{items:Run[]}>('/v1/launch/runs'); setRuns(data.items) }
  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.split('?')[1] || '').get('run'); if(id) setSelected(id)
    if (!session) return
    void api<{launch?:{modelConfigured:boolean}}>('/health').then(h => setAvailable(h.launch?.modelConfigured === true)).catch(e => setError(String(e)))
    void refresh().catch(e => setError(String(e)))
    const timer = setInterval(() => { void refresh().catch(e => setError(String(e))) },2500)
    return () => { clearInterval(timer); controller.current?.abort() }
  },[session])
  const choose = (id:string) => { setSelected(id); history.replaceState(null,'',`#agent?run=${encodeURIComponent(id)}`) }
  async function start(id:string,text = '') {
    if (controller.current) return
    setBusy(true); setError(''); const request = new AbortController(); controller.current = request
    try { await streamMessage(id,text,() => {},request.signal,true); setReply(''); await refresh() }
    catch(e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : String(e)); await refresh().catch(() => {}) }
    finally { if (controller.current === request) { controller.current = null; setBusy(false) } }
  }
  async function create() {
    if (creating.current || controller.current) return
    creating.current = true; setBusy(true); setError('')
    try { const {run} = await api<{run:Run}>('/v1/launch/runs',{goal}); choose(run.id); await refresh(); await start(run.id) }
    catch(e) {setError(String(e))}
    finally { creating.current = false; setBusy(false) }
  }
  async function approve(id:string,decision:'allow'|'deny') { try { await api(`/v1/sessions/${run!.sessionId}/approvals/${id}`,{decision}); await refresh() } catch(e) {setError(String(e))} }
  async function handoff() {
    if (!run) return
    try {
      const result = await api<{items:Array<{id?:string;reason?:string}>}>('/v1/community/migrate',{campaigns:[run.campaign]})
      const item = result.items[0]
      if (!item?.id) throw new Error(item?.reason || '草稿交接失败')
      window.location.hash = `projects?draft=${encodeURIComponent(item.id)}`
    } catch(e) {setError(String(e))}
  }
  const resolved = new Set((run?.events || []).filter(e => e.type === 'approval.resolved').map(e => e.approvalId))
  const pending = (run?.events || []).filter(e => e.type === 'approval.requested' && !resolved.has(e.approvalId))
  if (!session) return <section className="cw ip-container cw-agent-welcome"><div className="cw-agent-hero"><TechCore /><span className="ip-eyebrow">PRODUCT LAUNCH AGENT</span><h1>把目标交给 Agent。</h1><p>从一句产品想法开始，Agent 会帮你梳理方向、查找来源、分析供货方案，并把确认后的成果整理成项目草稿。</p><button className="ip-btn green" onClick={onAskLogin}>登录后开始使用</button><small>你的任务、执行记录和草稿会归属于你的账号。</small></div><div className="cw-agent-steps">{[['01','描述目标','说出你想解决的问题，Agent 会先确认边界。'],['02','共同研究','保留网页来源和供货目录证据，区分事实与推测。'],['03','确认交接','你确认后才写入项目，不会自动公开或收款。']].map(([n,t,d]) => <div key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}</div></section>
  return <section className="cw ip-container"><header className="cw-heading"><div><span className="ip-eyebrow">PRODUCT LAUNCH AGENT</span><h1>把目标交给 Agent。</h1><p>由模型规划，真实调用工具。每一步保留成果、来源和待确认事项。</p></div><a href="#projects" className="ip-btn light">项目编辑工作台</a></header>{!available && <div className="cw-review"><h2>模型尚未连接</h2><p>当前不能执行自主任务。需要在服务器安全配置 DeepSeek 模型密钥并启用 DSH 运行时；这里不会使用模板代替模型。</p></div>}{error && <p className="ip-form-error" role="alert">{error}</p>}<label>你想做什么产品？<textarea value={goal} onChange={e => setGoal(e.target.value)} maxLength={2000} placeholder="例如：我想做一款可维修台灯，先调研需求和供应可行性，再准备发布草稿。" /></label><button className="ip-btn green" disabled={!available || busy || goal.trim().length<4} onClick={create}>{busy ? 'Agent 正在执行…' : '开始 Agent 任务'}</button><div className="cw-layout"><nav aria-label="Agent 任务">{runs.map(r => <button key={r.id} className={r.id===selected?'active':''} onClick={() => choose(r.id)}>{r.goal.slice(0,40)} · {runStatusLabel(r.status)}</button>)}</nav>{run && <div className="cw-editor" key={run.id}><AgentRuntime status={run.status} activity={run.activity} events={run.events || []}/>{run.error && <p role="alert">{run.error}</p>}{pending.map(e => e.type === 'approval.requested' && <div className="cw-review agent-approval-card" key={e.approvalId}><h3>确认操作：{e.toolName}</h3><p>{e.reason}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(e.arguments,null,2)}</pre><button className="ip-btn green" onClick={() => approve(e.approvalId,'allow')}>确认执行</button><button className="ip-btn light" onClick={() => approve(e.approvalId,'deny')}>拒绝</button></div>)}{run.stages.map(s => <section key={s.id} className="agent-stage-result" data-ready={!!s.summary}><h3>{s.title} · {s.status}</h3><p>{s.summary || '尚未形成成果'}</p>{s.evidence.map((e,i) => <p key={i}>{e.kind === 'fact'?'来源记录':e.kind === 'inference'?'推测':'缺失'}：{e.text} {e.source?.url?.startsWith('https://') && <a href={e.source.url} target="_blank" rel="noreferrer">{e.source.title}</a>}</p>)}{s.questions.map((q,i) => <p key={i}>待确认：{q}</p>)}</section>)}<AgentEventLog events={run.events || []}/>{run.campaign.draft.story && <section className="agent-draft-result"><h3>Agent 已保存的项目草稿</h3><h4>{run.campaign.draft.name}</h4><p style={{whiteSpace:'pre-wrap'}}>{run.campaign.draft.story}</p><p>草稿保存在服务端任务中，尚未公开发布。</p><button className="ip-btn light" onClick={handoff}>确认转入我的项目</button></section>}<label>补充信息或下一步指令<textarea value={reply} onChange={e => setReply(e.target.value)} maxLength={4000}/></label><button className="ip-btn green" disabled={!available || busy || ['running','waiting_approval'].includes(run.status)} onClick={() => start(run.id,reply)}>继续 / 重试</button><button className="ip-btn light" disabled={!['running','waiting_approval'].includes(run.status)} onClick={async () => {try {await api(`/v1/launch/runs/${run.id}/abort`,{}); controller.current?.abort(); setBusy(false); await refresh()}catch(e){setError(String(e))}}}>中断任务</button></div>}</div></section>
}
