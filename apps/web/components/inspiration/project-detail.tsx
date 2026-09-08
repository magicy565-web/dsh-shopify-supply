import { useState, type FormEvent } from 'react'
import { creatorHref, workspaceHref, type Project } from '../../lib/inspiration'
import { Icon } from '../ui'
import { ProjectCard } from './project-card'
import { RelatedSupply } from './related-supply'

export type Comment = { text: string; date: string }
const date = (s: string) => new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

export function ProjectDetail({
  project: p, saved, followed, onSave, onFollow, comments, onComment,
  related, savedIds, followingIds, onSaveRelated, onShare, isOwner, onEdit, onDelete, onAddUpdate,
}: {
  project: Project
  saved: boolean
  followed: boolean
  onSave: () => void
  onFollow: () => void
  comments: Comment[]
  onComment: (text: string) => boolean
  related: Project[]
  savedIds: string[]
  followingIds: string[]
  onSaveRelated: (id: string) => void
  onShare: () => void
  isOwner: boolean
  onEdit: () => void
  onDelete: () => void
  onAddUpdate: (title: string, body: string) => boolean
}) {
  const [tab, setTab] = useState('story')
  const [text, setText] = useState('')
  const [updateTitle, setUpdateTitle] = useState('')
  const [updateBody, setUpdateBody] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const count = p.supporters + Number(followed)
  function addComment(e: FormEvent) { e.preventDefault(); if (text.trim().length >= 2 && onComment(text)) setText('') }
  function addUpdate(e: FormEvent) {
    e.preventDefault()
    if (updateTitle.trim().length < 2 || updateBody.trim().length < 8) return
    if (onAddUpdate(updateTitle.trim(), updateBody.trim())) { setUpdateTitle(''); setUpdateBody('') }
  }
  function download() {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = `inspiration-${p.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <article className="ip-detail">
      <div className="ip-container">
        <a href="#discover" className="ip-back"><Icon name="back" size={15} />返回灵感发现</a>
        <div className="ip-detail-heading">
          <span className="ip-eyebrow">{p.category} / {p.stage}</span>
          <h1>{p.name}</h1>
          <p>{p.tagline}</p>
          <a className="ip-byline" href={creatorHref(p.creator)}><span className="ip-avatar small">{p.creator.slice(0, 1)}</span>{p.creator}<span>· {p.city}</span></a>
        </div>
        <div className="ip-detail-hero">
          <div className="ip-detail-image">
            <img src={p.image} alt={`${p.name} 产品概念图`} />
            <span>{p.demo || p.image.startsWith('/inspiration/') ? 'AI 概念示意 · 非量产实物' : '创作者上传图片'}</span>
          </div>
          <aside className="ip-support-panel">
            <span className="ip-eyebrow">一起，让这个想法更进一步</span>
            <div className="ip-interest-number">{count}<span>人感兴趣</span></div>
            <div className="ip-progress" aria-label={`关注意向 ${count} / ${p.goal}`}><span style={{ width: `${Math.min(100, count / p.goal * 100)}%` }} /></div>
            <div className="ip-goal"><span>第一阶段关注目标</span><strong>{p.goal} 人</strong></div>
            <div className="ip-project-facts">
              <div><span>当前阶段</span><strong>{p.stage}</strong></div>
              <div><span>发布时间</span><strong>{date(p.date)}</strong></div>
            </div>
            <button className="ip-btn green wide" onClick={onFollow} aria-pressed={followed}><Icon name={followed ? 'check' : 'plus'} size={17} />{followed ? '已关注这个想法' : '我对这个想法感兴趣'}</button>
            <button className="ip-btn light wide" onClick={onSave} aria-pressed={saved}><Icon name={saved ? 'check' : 'bookmark'} size={16} />{saved ? '已加入我的收藏' : '收藏，稍后再看'}</button>
            <div className="ip-share-row">
              <button className="ip-btn light wide" onClick={onShare}><Icon name="share" size={15} />分享链接</button>
              {!p.demo && <button className="ip-btn light wide" onClick={download}><Icon name="external" size={15} />导出备份</button>}
            </div>
            <a href={workspaceHref(p)} className="ip-btn light wide"><Icon name="supply" size={15} />探索如何把它做出来</a>
            {isOwner && (
              <div className="ip-owner-actions">
                <button className="ip-btn light wide" onClick={onEdit}><Icon name="edit" size={15} />编辑项目</button>
                {confirmDelete
                  ? <div className="ip-delete-confirm"><p>删除后无法恢复，仅影响当前浏览器中的预览。</p><button className="ip-btn light" onClick={() => setConfirmDelete(false)}>取消</button><button className="ip-btn danger" onClick={onDelete}><Icon name="trash" size={14} />确认删除</button></div>
                  : <button className="ip-text-link" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} />删除本地预览</button>}
              </div>
            )}
            <p className="ip-support-note">{p.demo ? '示例项目与关注数仅用于演示。' : '这是你发布的本地预览项目。'}<br />关注意向只在此浏览器保存，不涉及付款。</p>
          </aside>
        </div>
      </div>
      <div className="ip-detail-tabs">
        <div className="ip-container">
          {[['story', '产品故事'], ['updates', `项目进展 ${p.updates.length}`], ['discussion', `想法交流 ${comments.length}`]].map(([id, title]) => (
            <button key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>
          ))}
        </div>
      </div>
      <div className="ip-detail-body ip-container">
        <section className="ip-project-story">
          {tab === 'story' && <>
            <span className="ip-eyebrow">THE IDEA BEHIND IT</span>
            <h2>为什么要创造它？</h2>
            <div className="ip-story-text">{p.story.split('\n\n').map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>
            <h2>我们在意的细节</h2>
            <ul className="ip-highlights">{p.highlights.map((h, i) => <li key={i}><span>0{i + 1}</span>{h}</li>)}</ul>
            <div className="ip-story-image"><img src={p.image} alt={`${p.name} 设计概念`} loading="lazy" /><p>想法仍在生长，最终方案以实际开发和验证为准。</p></div>
          </>}
          {tab === 'updates' && <>
            <h2>一点一点，把想法变成现实。</h2>
            {isOwner && (
              <form className="ip-update-form" onSubmit={addUpdate}>
                <label htmlFor="update-title">发布一条进展</label>
                <input id="update-title" required minLength={2} maxLength={80} value={updateTitle} onChange={e => setUpdateTitle(e.target.value)} placeholder="例如：完成第一版结构草图" />
                <textarea required minLength={8} maxLength={2000} rows={4} value={updateBody} onChange={e => setUpdateBody(e.target.value)} placeholder="说说这一步做了什么，以及接下来需要什么帮助。" />
                <button className="ip-btn green" disabled={updateTitle.trim().length < 2 || updateBody.trim().length < 8}>发布进展 <Icon name="chevron" size={14} /></button>
              </form>
            )}
            {p.updates.length ? <div className="ip-timeline">{p.updates.map((u, i) => <article key={`${u.date}-${i}`}><span>{date(u.date)}</span><h3>{u.title}</h3><p>{u.body}</p></article>)}</div> : <p className="ip-inline-empty">还没有发布项目进展。第一步，从分享这个想法开始。</p>}
          </>}
          {tab === 'discussion' && <>
            <h2>好产品，从交流中长出来。</h2>
            <p className="ip-discussion-intro">你会怎样使用它？有什么想法或期待？当前反馈仅在本地保存。</p>
            <form className="ip-comment-form" onSubmit={addComment}>
              <label htmlFor="project-feedback">分享你的想法</label>
              <textarea id="project-feedback" required minLength={2} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="聊聊这个产品吸引你的地方，或还可以改进的细节…" rows={4} />
              <button className="ip-btn green" disabled={text.trim().length < 2}>保存本地反馈 <Icon name="chevron" size={14} /></button>
            </form>
            <div className="ip-comments">{comments.map((c, i) => <article key={`${c.date}-${i}`}><span className="ip-avatar">我</span><div><strong>我 <small>{date(c.date)} · 本地反馈</small></strong><p>{c.text}</p></div></article>)}</div>
          </>}
        </section>
        <aside className="ip-story-sidebar">
          <div className="ip-creator-profile">
            <span className="ip-avatar big">{p.creator.slice(0, 1)}</span>
            <h3>{p.creator}</h3>
            <p>{p.city} · 产品创作者</p>
            <a className="ip-text-link" href={creatorHref(p.creator)}>查看 TA 的灵感 <Icon name="chevron" size={14} /></a>
          </div>
          <div className="ip-needs">
            <span className="ip-eyebrow">正在寻找同路人</span>
            <h3>你的参与，可能正是下一步。</h3>
            <div>{p.needs.length ? p.needs.map(n => <span key={n}>{n}</span>) : <span>欢迎交流</span>}</div>
            <p>为产品留下反馈，或把这个想法带到供应链工作台，看看有没有相近的供货可能。</p>
            <a href={workspaceHref(p)} className="ip-btn green wide"><Icon name="supply" size={16} />探索如何把它做出来</a>
          </div>
        </aside>
      </div>
      <RelatedSupply project={p} />
      {related.length > 0 && (
        <section className="ip-related ip-container">
          <div className="ip-section-heading">
            <div>
              <span className="ip-eyebrow">MORE IDEAS LIKE THIS</span>
              <h2>你可能也会喜欢</h2>
            </div>
            <a href="#discover" className="ip-text-link">查看全部 <Icon name="chevron" size={15} /></a>
          </div>
          <div className="ip-project-grid ip-related-grid">
            {related.map(item => (
              <ProjectCard key={item.id} project={item} saved={savedIds.includes(item.id)} followed={followingIds.includes(item.id)} onSave={() => onSaveRelated(item.id)} />
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
