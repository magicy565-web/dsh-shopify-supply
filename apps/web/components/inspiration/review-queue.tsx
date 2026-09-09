'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { campaignIssues, campaignSteps, type Campaign } from '../../lib/campaign'

export function ReviewQueue() {
  const [items, setItems] = useState<Campaign[]>([])
  const [activeId, setActiveId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const active = items.find(item => item.id === activeId)

  async function load() {
    try {
      const result = await api<{ items: Campaign[] }>('/v1/community/review')
      setItems(result.items)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取审核队列')
    }
  }

  useEffect(() => { void load() }, [])

  async function decide(action: 'approve' | 'return') {
    if (!active) return
    if (action === 'return' && note.trim().length < 2) { setError('退回时请填写修改意见'); return }
    try {
      await api(`/v1/community/review/${encodeURIComponent(active.id)}`, { action, note: note.trim() })
      setNote('')
      setActiveId('')
      setSaved(action === 'approve' ? '已通过，创作者可以正式发布。' : '已退回，意见会通知创作者。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核操作失败')
    }
  }

  if (active) {
    const issues = campaignIssues(active)
    return (
      <section className="cw ip-container">
        <header className="cw-heading">
          <div>
            <button className="ip-text-link" onClick={() => setActiveId('')}>← 审核队列</button>
            <h1>{active.draft.name || '未命名项目'}</h1>
            <p>{active.draft.creator} · {active.draft.city} · 提交真实审核，不涉及付款。</p>
          </div>
        </header>
        {error && <p className="ip-form-error" role="alert">{error}</p>}
        <article className="cw-preview">
          {active.draft.image && <img src={active.draft.image} alt="" />}
          <div>
            <span className="ip-eyebrow">{active.draft.category} · {active.draft.stage}</span>
            <h2>{active.draft.name}</h2>
            <p>{active.draft.tagline}</p>
            <h3>产品故事</h3>
            <p>{active.draft.story}</p>
            <h3>产品亮点</h3>
            <p>{active.draft.highlights}</p>
            {(['audience','milestones','participation','team','risks'] as const).map((key, i) => (
              <section key={key}><h3>{['目标用户','进展计划','参与说明','团队','风险与挑战'][i]}</h3><p>{active.content[key]}</p></section>
            ))}
          </div>
        </article>
        <div className="cw-checks">{issues.map((issue, i) => <div key={campaignSteps[i]} className="cw-review"><span>{issue ? '○' : '✓'} {campaignSteps[i]}</span><small>{issue || '已准备'}</small></div>)}</div>
        <div className="cw-review">
          <h2>审核决定</h2>
          <label>意见（退回时必填）<textarea rows={4} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="说明需要补充的验证、风险或表达问题" /></label>
          <div className="cw-card-actions">
            <button className="ip-btn light" onClick={() => void decide('return')}>退回修改</button>
            <button className="ip-btn green" onClick={() => void decide('approve')}>审核通过</button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="cw ip-container">
      <header className="cw-heading">
        <div>
          <span className="ip-eyebrow">REVIEW QUEUE</span>
          <h1>待审核项目</h1>
          <p>通过或退回都会写入意见，并通知创作者。发布后其他用户才能打开分享链接。</p>
        </div>
      </header>
      {error && <p className="ip-form-error" role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
      <div className="cw-projects">
        {items.map(item => (
          <article key={item.id}>
            {item.draft.image ? <img src={item.draft.image} alt="" /> : <div className="cw-placeholder">REVIEW</div>}
            <div>
              <span className="cw-badge">待审核</span>
              <h2>{item.draft.name || '未命名项目'}</h2>
              <p>{item.draft.tagline}</p>
              <small>{item.draft.creator} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</small>
              <div className="cw-card-actions"><button className="ip-btn light" onClick={() => setActiveId(item.id)}>打开审核</button></div>
            </div>
          </article>
        ))}
      </div>
      {!items.length && <div className="cw-empty"><h2>当前没有待审核项目。</h2><p>创作者提交后会出现在这里。</p></div>}
    </section>
  )
}
