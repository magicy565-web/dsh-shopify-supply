import { useState, type FormEvent } from 'react'
import { creatorHref, sharePath, workspaceHref, type Project } from '../../lib/inspiration'
import { Icon } from '../ui'
import { ProjectCard } from './project-card'
import { RelatedSupply } from './related-supply'
import type { CommunityApplication, CommunityComment, SessionUser } from '../../lib/session'

export type Comment = { id?: string; text: string; date: string; authorName?: string; parentId?: string | null }
const date = (s: string) => new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

export function ProjectDetail({
  project: p, saved, followed, onSave, onFollow, comments, onComment, onReply,
  related, savedIds, followingIds, onSaveRelated, onShare, isOwner, onEdit, onDelete, onAddUpdate,
  session, onAskLogin, applications, onApply,
}: {
  project: Project
  saved: boolean
  followed: boolean
  onSave: () => void
  onFollow: () => void
  comments: Comment[]
  onComment: (text: string) => boolean | Promise<boolean>
  onReply?: (text: string, parentId: string) => boolean | Promise<boolean>
  related: Project[]
  savedIds: string[]
  followingIds: string[]
  onSaveRelated: (id: string) => void
  onShare: () => void
  isOwner: boolean
  onEdit: () => void
  onDelete: () => void
  onAddUpdate: (title: string, body: string) => boolean | Promise<boolean>
  session: SessionUser | null
  onAskLogin: () => void
  applications?: CommunityApplication[]
  onApply?: (kind: 'tester' | 'collab', message: string) => Promise<boolean>
}) {
  const [tab, setTab] = useState('story')
  const [text, setText] = useState('')
  const [replyFor, setReplyFor] = useState('')
  const [replyText, setReplyText] = useState('')
  const [updateTitle, setUpdateTitle] = useState('')
  const [updateBody, setUpdateBody] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tester, setTester] = useState('')
  const [collab, setCollab] = useState('')
  const count = p.supporters
  const thread = comments.filter(item => !item.parentId)
  function childrenOf(id?: string) { return comments.filter(item => item.parentId && item.parentId === id) }
  async function addComment(e: FormEvent) {
    e.preventDefault()
    if (!session) { onAskLogin(); return }
    if (text.trim().length >= 2 && await onComment(text)) setText('')
  }
  async function sendReply(e: FormEvent) {
    e.preventDefault()
    if (!session || !replyFor || !onReply) { onAskLogin(); return }
    if (replyText.trim().length >= 2 && await onReply(replyText, replyFor)) { setReplyText(''); setReplyFor('') }
  }
  async function addUpdate(e: FormEvent) {
    e.preventDefault()
    if (updateTitle.trim().length < 2 || updateBody.trim().length < 8) return
    if (await onAddUpdate(updateTitle.trim(), updateBody.trim())) { setUpdateTitle(''); setUpdateBody('') }
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
            <button className="ip-btn green wide" onClick={() => session ? onFollow() : onAskLogin()} aria-pressed={followed}><Icon name={followed ? 'check' : 'plus'} size={17} />{followed ? '已关注这个想法' : '我对这个想法感兴趣'}</button>
            <button className="ip-btn light wide" onClick={() => session ? onSave() : onAskLogin()} aria-pressed={saved}><Icon name={saved ? 'check' : 'bookmark'} size={16} />{saved ? '已加入我的收藏' : '收藏，稍后再看'}</button>
            <div className="ip-share-row">
              <button className="ip-btn light wide" onClick={onShare}><Icon name="share" size={15} />分享链接</button>
              {!p.demo && <button className="ip-btn light wide" onClick={download}><Icon name="external" size={15} />导出备份</button>}
            </div>
            <a href={workspaceHref(p)} className="ip-btn light wide"><Icon name="supply" size={15} />探索如何把它做出来</a>
            {isOwner && (
              <div className="ip-owner-actions">
                <button className="ip-btn light wide" onClick={onEdit}><Icon name="edit" size={15} />管理项目 / 运营</button>
                {p.demo === false && p.id.startsWith('local-') && (confirmDelete
                  ? <div className="ip-delete-confirm"><p>仅删除尚未迁移的本地预览。</p><button className="ip-btn light" onClick={() => setConfirmDelete(false)}>取消</button><button className="ip-btn danger" onClick={onDelete}><Icon name="trash" size={14} />确认删除</button></div>
                  : null)}
              </div>
            )}
            <p className="ip-support-note">{p.demo ? '示例项目与关注数仅用于演示。' : '这是已发布的公开项目。收藏、关注、评论和申请会保存到账号。'}<br />当前不涉及付款。分享链接：{sharePath(p.id)}</p>
          </aside>
        </div>
      </div>
      <div className="ip-detail-tabs">
        <div className="ip-container">
          {[['story', '产品故事'], ['updates', `项目进展 ${p.updates.length}`], ['discussion', `想法交流 ${comments.length}`], ['join', '参与']].map(([id, title]) => (
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
            {p.campaign && <>
              {p.campaign.gallery.map((src, i) => <div className="ip-story-image" key={i}><img src={src} alt={`${p.name} 展示 ${i + 1}`} loading="lazy" /></div>)}
              {p.campaign.video.startsWith('https://') && <a href={p.campaign.video} target="_blank" rel="noopener noreferrer" className="ip-text-link">观看演示视频 ↗</a>}
              {(['audience', 'milestones', 'participation', 'team', 'risks'] as const).map((key, i) => <section key={key}><h2>{['为谁而设计', '已有成果与下一步', '如何参与', '认识创作团队', '风险与待验证问题'][i]}</h2><div className="ip-story-text">{p.campaign![key].split('\n').map((line, n) => <p key={n}>{line}</p>)}</div></section>)}
            </>}
          </>}
          {tab === 'updates' && <>
            <h2>一点一点，把想法变成现实。</h2>
            {isOwner && (
              <form className="ip-update-form" onSubmit={e => void addUpdate(e)}>
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
            <p className="ip-discussion-intro">{p.demo ? '示例项目的本地留言仅供预览。' : '评论会保存到账号，刷新或换设备后仍然可见。'}</p>
            <form className="ip-comment-form" onSubmit={e => void addComment(e)}>
              <label htmlFor="project-feedback">分享你的想法</label>
              <textarea id="project-feedback" required minLength={2} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="聊聊这个产品吸引你的地方，或还可以改进的细节…" rows={4} />
              <button className="ip-btn green" disabled={text.trim().length < 2}>{session ? '发布评论' : '登录后评论'} <Icon name="chevron" size={14} /></button>
            </form>
            <div className="ip-comments">
              {thread.map(c => (
                <article key={c.id ?? `${c.date}-${c.text}`}>
                  <span className="ip-avatar">{(c.authorName ?? '我').slice(0, 1)}</span>
                  <div>
                    <strong>{c.authorName ?? '我'} <small>{date(c.date)}</small></strong>
                    <p>{c.text}</p>
                    {session && c.id && <button className="ip-text-link" onClick={() => setReplyFor(c.id!)}>回复</button>}
                    {childrenOf(c.id).map(child => (
                      <article key={child.id} className="ip-comment-reply">
                        <strong>{child.authorName} <small>{date(child.date)}</small></strong>
                        <p>{child.text}</p>
                      </article>
                    ))}
                    {replyFor === c.id && (
                      <form className="ip-comment-form" onSubmit={e => void sendReply(e)}>
                        <textarea required minLength={2} maxLength={1000} value={replyText} onChange={e => setReplyText(e.target.value)} rows={3} placeholder={`回复 ${c.authorName ?? ''}`} />
                        <button className="ip-btn green" disabled={replyText.trim().length < 2}>发送回复</button>
                      </form>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>}
          {tab === 'join' && <>
            <h2>测试报名与合作申请</h2>
            <p className="ip-discussion-intro">向创作者说明你能如何参与。申请会进入创作者运营中心，不涉及付款。</p>
            {p.demo && <p>示例项目不接受真实申请。</p>}
            {!p.demo && !session && <button className="ip-btn green" onClick={onAskLogin}>登录后申请参与</button>}
            {!p.demo && session && !isOwner && onApply && <>
              <form className="ip-comment-form" onSubmit={e => { e.preventDefault(); void onApply('tester', tester).then(ok => { if (ok) setTester('') }) }}>
                <label>测试报名<textarea required minLength={8} maxLength={1000} rows={4} value={tester} onChange={e => setTester(e.target.value)} placeholder="你能提供怎样的试用反馈？时间如何安排？" /></label>
                <button className="ip-btn green">提交测试报名</button>
              </form>
              <form className="ip-comment-form" onSubmit={e => { e.preventDefault(); void onApply('collab', collab).then(ok => { if (ok) setCollab('') }) }}>
                <label>合作申请<textarea required minLength={8} maxLength={1000} rows={4} value={collab} onChange={e => setCollab(e.target.value)} placeholder="你能提供的能力、过往经验和期望的合作方式。" /></label>
                <button className="ip-btn green">提交合作申请</button>
              </form>
            </>}
            {isOwner && applications && (
              <div>
                <h3>收到的申请</h3>
                {applications.length ? applications.map(item => <article key={item.id} className="cw-review"><strong>{item.applicantName}</strong><small> · {item.kind === 'tester' ? '测试' : '合作'} · {item.status}</small><p>{item.message}</p></article>) : <p>还没有申请。可在运营中心处理。</p>}
                <a className="ip-btn light" href={`#projects?draft=${p.id}`}>打开运营中心</a>
              </div>
            )}
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
