'use client'

import { VisualImage } from './visual-effects'
import { useEffect, useRef, useState } from 'react'
import { examples, type Draft } from '../../lib/inspiration'
import { Icon } from '../ui'

const steps = ['产品构想', '设计方向', '发布准备']
const directions = [
  { title: '温柔的日常', subtitle: '自然材质 · 柔和光线 · 克制细节', image: examples[0].image, color: '#d3c8af' },
  { title: '精确的工具', subtitle: '清晰结构 · 金属质感 · 功能优先', image: examples[1].image, color: '#a7adb0' },
  { title: '向自然出发', subtitle: '耐用织物 · 大地色彩 · 模块组合', image: examples[2].image, color: '#7b8268' },
]

export function CreativeStudio({ draft, setDraft, onSave, onPublish }: { draft: Draft; setDraft: (draft: Draft) => void; onSave: () => void; onPublish: () => void }) {
  const [step, setStep] = useState(0)
  const editor = useRef<HTMLDivElement>(null)
  const previousStep = useRef(step)
  const [focusRequest, setFocusRequest] = useState(0)
  const direction = directions.findIndex(d => d.image === draft.image)
  const [error, setError] = useState('')
  const update = (key: keyof Draft, value: string) => setDraft({ ...draft, [key]: value })
  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    editor.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [step])
  const complete = [!!draft.name.trim() && !!draft.tagline.trim() && draft.story.trim().length >= 40, !!draft.image && !!draft.highlights.trim(), !!draft.creator.trim() && !!draft.city.trim()]
  useEffect(() => {
    if (!focusRequest) return
    editor.current?.querySelector<HTMLElement>('[aria-invalid=true]')?.focus()
  }, [focusRequest])
  const messages = ['填写名称、一句话介绍和至少 40 字的产品构想。', '选择封面并填写至少一个产品亮点。', '填写创作者名称和所在地。']
  function exportBrief() {
    const text = [`# ${draft.name || '未命名灵感'}`, draft.tagline, '## 产品构想', draft.story, '## 产品亮点', draft.highlights, '## 合作需求', draft.needs.join('、'), '## 创作者', `${draft.creator} · ${draft.city}`, '本简报为创作者填写的概念草稿，尚未经过产品验证。'].join('\n\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = '产品创作简报.md'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function next() {
    const missing = step === 2 ? complete.findIndex(value => !value) : complete[step] ? -1 : step
    if (missing !== -1) { setStep(missing); setError(messages[missing]); setFocusRequest(n => n + 1); return }
    setError('')
    if (step === 2) onPublish(); else setStep(step + 1)
  }
  return <section className="qs-studio ip-container">
    <div className="qs-heading"><div><span className="ip-eyebrow">IDEA → DIRECTION → RELEASE</span><h1>让一个想法，慢慢成形。</h1><p>创作工作室 · 参考启物的分阶段创作流程</p></div><button className="ip-btn light" onClick={onSave}><Icon name="bookmark" size={15} />保存草稿</button></div>
    <div className="qs-layout"><aside className="qs-steps"><span className="ip-eyebrow">你的创作路径</span>{steps.map((name, i) => <button key={name} className={step === i ? 'active' : ''} onClick={() => { setStep(i); setError('') }} aria-current={step === i ? 'step' : undefined}><span data-complete={complete[i]}>{complete[i] ? <Icon name="check" size={14} /> : `0${i + 1}`}</span><div><strong>{name}</strong><small>{['发现值得解决的问题', '为产品找到自己的性格', '让故事准备好被看见'][i]}</small></div></button>)}<div className="qs-note"><VisualImage className="studio-guide" src="/inspiration/creation-guide-v1.webp" alt="概念节点逐步组合成产品模块的示意图"/><small>概念视觉 · AI 生成</small><p>这里是手动创作与预览。方向图为示例素材，不会自动生成设计或调用 AI。</p></div></aside>
    <div ref={editor} className="qs-editor" key={step}><div className="qs-editor-title"><span>WORKSPACE / 0{step + 1}</span><small>{complete.filter(Boolean).length} / 3 已准备</small></div>
      {step === 0 && <><h2>你想让哪件小事变得更好？</h2><p className="qs-description">从真实的日常出发。先讲清楚问题，再考虑答案。</p><label>产品名称<input aria-invalid={!!error && !draft.name.trim()} maxLength={60} value={draft.name} onChange={e => update('name', e.target.value)} placeholder="给你的想法起个名字" /></label><label>一句话介绍<input aria-invalid={!!error && !draft.tagline.trim()} maxLength={100} value={draft.tagline} onChange={e => update('tagline', e.target.value)} placeholder="它为谁，解决什么问题？" /></label><label>产品构想<textarea aria-invalid={!!error && draft.story.trim().length < 40} rows={7} maxLength={6000} value={draft.story} onChange={e => update('story', e.target.value)} placeholder="你遇到了什么问题？现有产品哪里还不够好？你希望带来怎样的改变？" /><small>{draft.story.length} 字 · 至少 40 字</small></label></>}
      {step === 1 && <><h2>选择一种表达，留下你的判断。</h2><p className="qs-description">这些是风格参考。选择后会作为草稿封面，发布时也可以上传自己的图片。</p><div className="qs-directions">{directions.map((d, i) => <button key={d.title} className={direction === i ? 'selected' : ''} aria-invalid={!!error && !draft.image && i === 0} aria-pressed={direction === i} onClick={() => { update('image', d.image) }}><img src={d.image} alt={`${d.title} 示例方向`} /><span className="qs-swatch" style={{ background: d.color }} /><strong>{d.title}</strong><small>{d.subtitle}</small>{direction === i && <span className="qs-selected"><Icon name="check" size={13} />已选择</span>}</button>)}</div><label>产品亮点<textarea aria-invalid={!!error && !draft.highlights.trim()} rows={4} maxLength={1000} value={draft.highlights} onChange={e => update('highlights', e.target.value)} placeholder={'每行一个具体亮点\n例如：电池可独立更换，延长使用寿命'} /></label></>}
      {step === 2 && <><h2>下一步，让同路人找到你。</h2><p className="qs-description">完善创作者信息，再进入发布表单检查分类、合作需求和最终内容。</p><div className="qs-ready-card">{draft.image && <img src={draft.image} alt="待发布草稿" />}<div><span className="ip-eyebrow">DRAFT PREVIEW</span><h3>{draft.name || '未命名灵感'}</h3><p>{draft.tagline || '还可以补充一句话介绍'}</p><span>{draft.highlights.split('\n').filter(Boolean).length} 个产品亮点</span></div></div><label>创作者 / 工作室<input aria-invalid={!!error && !draft.creator.trim()} maxLength={50} value={draft.creator} onChange={e => update('creator', e.target.value)} placeholder="你的名字或品牌" /></label><label>所在地<input aria-invalid={!!error && !draft.city.trim()} maxLength={40} value={draft.city} onChange={e => update('city', e.target.value)} placeholder="例如：杭州" /></label></>}
      {step === 2 && <div className="qs-checklist"><h3>发布前检查</h3>{steps.map((name, i) => <button key={name} onClick={() => { setStep(i); setError('') }}><span>{complete[i] ? '✓' : '○'} {name}</span><small>{complete[i] ? '已准备' : messages[i]}</small></button>)}<button className="ip-btn light" onClick={exportBrief}>导出创作简报</button></div>}
      {error && <p className="ip-form-error" role="alert">{error}</p>}<div className="qs-editor-actions"><span>草稿与发布表单共享内容</span>{step > 0 && <button className="ip-btn light" onClick={() => { setStep(step - 1); setError('') }}>上一步</button>}<button className="ip-btn green" onClick={next}>{step === 2 ? '进入发布表单' : '继续下一步'}<Icon name="chevron" size={15} /></button></div>
    </div></div>
  </section>
}
