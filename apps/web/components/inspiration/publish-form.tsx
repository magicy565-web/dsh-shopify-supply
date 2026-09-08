import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { categories, stages, examples, draftProject, type Draft, type Project } from '../../lib/inspiration'
import { Icon } from '../ui'
import { ProjectCard } from './project-card'

export function PublishForm({ draft, setDraft, onSave, onPublish, existing }: { draft: Draft; setDraft: (draft: Draft) => void; onSave: () => void; onPublish: (project: Project) => boolean; existing?: Project }) {
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [reading, setReading] = useState(false)
  const imageVersion = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const editing = Boolean(existing)
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value })
  function validate() {
    if (!draft.name.trim() || !draft.tagline.trim() || !draft.creator.trim() || !draft.city.trim()) return '请填写产品名称、介绍、创作者和所在地。'
    if (!draft.image) return '请上传封面，或选择一张示例概念图。'
    if (step > 0 && draft.story.trim().length < 40) return '产品故事至少需要 40 个字，讲讲你想解决的问题。'
    if (step > 0 && !draft.highlights.trim()) return '请至少填写一个产品亮点。'
    if (step > 0 && (!Number.isSafeInteger(Number(draft.goal)) || Number(draft.goal) < 1 || Number(draft.goal) > 100000)) return '关注目标请输入 1 至 100,000 之间的整数。'
    return ''
  }
  function next(e: FormEvent) {
    e.preventDefault()
    const issue = validate()
    if (issue) { setError(issue); return }
    setError('')
    if (step < 2) { setStep(step + 1); setTimeout(() => heading.current?.focus(), 0) }
    else if (!consent) setError('请确认你了解本地预览的保存范围。')
    else onPublish(draftProject(draft, existing))
  }
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 1024 * 1024) { setError('请选择不超过 1 MB 的 JPG、PNG 或 WebP 图片。'); e.target.value = ''; return }
    const version = ++imageVersion.current
    setReading(true); setError('')
    const reader = new FileReader()
    reader.onload = () => { if (version === imageVersion.current) { update('image', String(reader.result)); setReading(false) } }
    reader.onerror = () => { setError('图片读取失败，请换一张重试。'); setReading(false) }
    reader.readAsDataURL(file)
  }
  return <section className="ip-publish ip-container"><div className="ip-publish-intro"><span className="ip-eyebrow">{editing ? 'REFINE THE STORY' : 'EVERY GREAT PRODUCT STARTS WITH AN IDEA'}</span><h1 ref={heading} tabIndex={-1}>{editing ? '把这个想法，再讲清楚一点。' : '让你的灵感，被看见。'}</h1><p>{editing ? '更新后的内容仍然只保存在当前浏览器，不会对其他用户公开。' : '不必等到一切准备就绪。讲出你的想法，找到愿意一起向前的人。'}</p></div><ol className="ip-steps">{['基本信息','产品故事','预览与发布'].map((label,i) => <li className={i <= step ? 'active' : ''} aria-current={i === step ? 'step' : undefined} key={label}><span>{i < step ? <Icon name="check" size={14} /> : `0${i+1}`}</span>{label}</li>)}</ol><div className="ip-publish-grid"><form onSubmit={next} className="ip-publish-form"><div className="ip-form-title"><h2>{['先从一个好名字开始','聊聊你为什么想做它', editing ? '确认这些更新' : '这是你的灵感，准备好了吗？'][step]}</h2><span>{step + 1} / 3</span></div>{error && <div className="ip-form-error" role="alert">{error}</div>}
    {step === 0 && <><label>产品名称 <span>*</span><input value={draft.name} onChange={e => update('name',e.target.value)} maxLength={60} required placeholder="例如：RE:LIGHT 可维修便携灯" /></label><label>一句话介绍 <span>*</span><input value={draft.tagline} onChange={e => update('tagline',e.target.value)} maxLength={100} required placeholder="它是什么？为什么值得被创造？" /></label><div className="ip-form-row"><label>产品分类<select value={draft.category} onChange={e => update('category',e.target.value)}>{categories.slice(1).map(c => <option key={c}>{c}</option>)}</select></label><label>当前阶段<select value={draft.stage} onChange={e => update('stage',e.target.value)}>{stages.map(s => <option key={s}>{s}</option>)}</select></label></div><div className="ip-form-row"><label>创作者 / 品牌名称 <span>*</span><input required maxLength={50} value={draft.creator} onChange={e => update('creator',e.target.value)} placeholder="你的名字或工作室" /></label><label>所在地 <span>*</span><input required maxLength={40} value={draft.city} onChange={e => update('city',e.target.value)} placeholder="例如：杭州" /></label></div><div className="ip-field-title">项目封面 <span>*</span></div><label className={`ip-upload ${draft.image ? 'has-image' : ''}`}>{draft.image ? <img src={draft.image} alt="待发布项目封面" /> : <><Icon name="plus" size={25} /><strong>上传一张让人停下来的图片</strong><small>JPG、PNG 或 WebP，最大 1 MB</small></>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} aria-label="上传项目封面" /><span className="ip-upload-action">{reading ? '正在读取…' : draft.image ? '更换封面' : '选择图片'}</span></label><p className="ip-field-hint">也可以先用一张 AI 生成的示例概念图：</p><div className="ip-cover-options">{examples.map(p => <button type="button" key={p.id} aria-label={`使用 ${p.name} 示例封面`} aria-pressed={draft.image === p.image} className={draft.image === p.image ? 'selected' : ''} onClick={() => {imageVersion.current++; setReading(false); update('image',p.image)}}><img src={p.image} alt={p.name} /></button>)}</div></>}
    {step === 1 && <><label>你的产品故事 <span>*</span><textarea required minLength={40} maxLength={6000} rows={9} value={draft.story} onChange={e => update('story',e.target.value)} placeholder="你发现了什么问题？这个产品会如何改善生活？已经做了什么，还需要什么帮助？" /><small>{draft.story.length} / 6000 · 至少 40 字</small></label><label>产品亮点 <span>*</span><textarea required maxLength={1000} rows={4} value={draft.highlights} onChange={e => update('highlights',e.target.value)} placeholder={'每行一个亮点\n例如：可独立更换电池的模块结构'} /></label><fieldset><legend>你希望遇见怎样的帮助？</legend><div className="ip-need-options">{['用户反馈','测试用户','供应链合作','打样支持','工业设计','内容共创'].map(need => <label key={need}><input type="checkbox" checked={draft.needs.includes(need)} onChange={() => update('needs',draft.needs.includes(need) ? draft.needs.filter(n => n !== need) : [...draft.needs,need])} />{need}</label>)}</div></fieldset><label>第一阶段希望获得多少人的关注？<input type="number" min={1} max={100000} step={1} required value={draft.goal} onChange={e => update('goal',e.target.value)} /><small>这是意向关注目标，不涉及筹款或付款。</small></label></>}
    {step === 2 && <div className="ip-publish-summary"><div><span>产品故事</span><p>{draft.story}</p></div><div><span>产品亮点</span><ul>{draft.highlights.split('\n').filter(Boolean).map((h,i) => <li key={i}>{h}</li>)}</ul></div><div><span>寻找合作</span><p>{draft.needs.join(' · ') || '暂未选择'}</p></div><div className="ip-local-notice"><Icon name="globe" size={20} /><p>{editing ? '保存后会覆盖当前浏览器中的这份预览项目。' : '这是 Web UI 预览。发布的灵感只保存在当前浏览器，不会对其他用户公开。后续接入账号与后台后，再启用正式发布。'}</p></div><label className="ip-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我了解保存范围，并确认已检查项目内容。</label></div>}
    <div className="ip-form-actions">{editing ? <span /> : <button type="button" className="ip-btn light" onClick={onSave} disabled={reading}>保存草稿</button>}<div>{step > 0 && <button type="button" className="ip-btn light" onClick={() => {setStep(step-1); setError('')}}>上一步</button>}<button className="ip-btn green" disabled={reading || (step === 2 && !consent)}>{step === 2 ? (editing ? '保存更新' : '发布到本地预览') : '下一步'}<Icon name="chevron" size={16} /></button></div></div></form><aside className="ip-publish-preview"><span className="ip-eyebrow">你的灵感卡片</span>{draft.image ? <ProjectCard project={draftProject(draft)} saved={false} followed={false} onSave={() => setError('这是卡片预览，发布后即可收藏。')} /> : <div className="ip-preview-placeholder"><Icon name="spark" size={33} /><h3>一个好想法，正在成形。</h3><p>添加封面与介绍，<br />看看你的项目会如何呈现。</p></div>}<div className="ip-publish-tip"><span>一点小建议</span><h3>好的故事，让人愿意参与。</h3><p>讲具体的问题，展示真实的进展，也坦诚说出还没解决的难题。</p></div></aside></div></section>
}
