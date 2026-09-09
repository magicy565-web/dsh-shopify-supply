'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { sharePath, type Project } from '../../lib/inspiration'
import type { Campaign } from '../../lib/campaign'
import type { CommunityApplication, CommunityComment } from '../../lib/session'

type Detail = {
  project: Project
  comments: CommunityComment[]
  applications: CommunityApplication[]
  participants: { followers: Array<{ id: string; name: string }>; saves: number }
}

export function CampaignOps({ campaign, onNotice }: { campaign: Campaign; onNotice: (text: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})

  async function load() {
    try {
      const result = await api<Detail>(`/v1/community/projects/${encodeURIComponent(campaign.id)}`)
      setDetail(result)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取参与数据')
    }
  }

  useEffect(() => { void load() }, [campaign.id])

  async function respond(id: string, action: 'accept' | 'decline') {
    try {
      await api(`/v1/community/applications/${encodeURIComponent(id)}`, { action, response: reply[id] ?? '' })
      onNotice(action === 'accept' ? '已接受申请，对方会收到通知。' : '已婉拒申请，对方会收到通知。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理申请失败')
    }
  }

  async function publishUpdate(event: FormEvent) {
    event.preventDefault()
    try {
      await api(`/v1/community/projects/${encodeURIComponent(campaign.id)}`, { action: 'update', title, body })
      setTitle('')
      setBody('')
      onNotice('进展已发布，关注者会收到通知。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布进展失败')
    }
  }

  const pending = detail?.applications.filter(item => item.status === 'pending') ?? []
  const handled = detail?.applications.filter(item => item.status !== 'pending') ?? []
  const share = typeof window !== 'undefined' ? `${window.location.origin}${sharePath(campaign.id)}` : sharePath(campaign.id)

  return (
    <div className="cw-ops">
      <h2>创作者运营中心</h2>
      <p>查看谁在参与、处理申请、发布进展。支付尚未接入。</p>
      {error && <p className="ip-form-error" role="alert">{error}</p>}
      <div className="cw-review">
        <h3>分享链接</h3>
        <p>{share}</p>
        <div className="cw-card-actions">
          <a className="ip-btn light" href={`#project/${campaign.id}`}>打开公开页</a>
          <button className="ip-btn green" onClick={() => { void navigator.clipboard?.writeText(share); onNotice('分享链接已复制') }}>复制链接</button>
        </div>
      </div>
      <div className="cw-stats">
        {[['关注', detail?.participants.followers.length ?? 0], ['收藏', detail?.participants.saves ?? 0], ['待处理申请', pending.length], ['评论', detail?.comments.length ?? 0]].map(([label, n]) => (
          <div key={String(label)}><strong>{n}</strong><span>{label}</span></div>
        ))}
      </div>
      <section>
        <h3>关注名单</h3>
        {detail?.participants.followers.length ? <ul>{detail.participants.followers.map(item => <li key={item.id}>{item.name}</li>)}</ul> : <p>还没有人关注。</p>}
      </section>
      <section>
        <h3>待处理申请</h3>
        {pending.length ? pending.map(item => (
          <article className="cw-review" key={item.id}>
            <strong>{item.applicantName}</strong>
            <small> · {item.kind === 'tester' ? '测试报名' : '合作申请'}</small>
            <p>{item.message}</p>
            <label>回复说明<input value={reply[item.id] ?? ''} onChange={e => setReply(current => ({ ...current, [item.id]: e.target.value }))} /></label>
            <div className="cw-card-actions">
              <button className="ip-btn green" onClick={() => void respond(item.id, 'accept')}>接受</button>
              <button className="ip-btn light" onClick={() => void respond(item.id, 'decline')}>婉拒</button>
            </div>
          </article>
        )) : <p>没有待处理的申请。</p>}
      </section>
      {handled.length > 0 && (
        <section>
          <h3>已处理</h3>
          {handled.map(item => <p key={item.id}>{item.applicantName} · {item.kind === 'tester' ? '测试' : '合作'} · {item.status === 'accepted' ? '已接受' : '已婉拒'}</p>)}
        </section>
      )}
      <form className="ip-update-form" onSubmit={e => void publishUpdate(e)}>
        <h3>发布进展</h3>
        <input required minLength={2} maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="进展标题" />
        <textarea required minLength={8} maxLength={2000} rows={4} value={body} onChange={e => setBody(e.target.value)} placeholder="这一步做了什么，接下来需要什么帮助。不涉及付款。" />
        <button className="ip-btn green">发布进展</button>
      </form>
    </div>
  )
}
