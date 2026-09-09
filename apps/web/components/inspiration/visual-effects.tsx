'use client'

import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

export function useMotionVisibility<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let visible = false
    const update = () => { element.dataset.motionPaused = String(!visible || document.hidden) }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update() })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    update()
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])
  return ref
}

export function VisualImage({ src, alt = '', className = '', ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string }) {
  const image = useRef<HTMLImageElement>(null)
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const [failedSrc, setFailedSrc] = useState<string>()
  const [instantSrc, setInstantSrc] = useState<string>()
  useEffect(() => {
    if (image.current?.complete) {
      if (image.current.naturalWidth) { setLoadedSrc(src); setInstantSrc(src) }
      else setFailedSrc(src)
    }
  }, [src])
  const failed = failedSrc === src
  return <span className={`visual-image ${className}`} data-loaded={loadedSrc === src} data-failed={failed} data-cached={instantSrc === src}>
    {!failed && <img {...props} ref={image} src={src} alt={alt} onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)} />}
    {failed && <span className="visual-image-fallback" role={alt ? 'img' : undefined} aria-label={alt || undefined}>图片暂不可用</span>}
  </span>
}

export function TechHero() {
  const ref = useMotionVisibility<HTMLElement>()
  return <section ref={ref} className="tech-hero ip-container" aria-labelledby="tech-hero-title">
    <div className="tech-hero-art" aria-hidden="true"><VisualImage src="/inspiration/tech-hero-v1.webp" loading="eager" fetchPriority="high"/><div className="tech-grid"/><svg className="tech-trails" viewBox="0 0 1000 500" preserveAspectRatio="none"><path d="M-100 400 C300 400 430 80 1100 150"/><path d="M-100 450 C450 450 450 150 1100 230"/></svg></div>
    <div className="tech-hero-copy"><span className="tech-kicker"><i/> IDEAS, CONNECTED.</span><h1 id="tech-hero-title">让想法连接可能。<br/><span>让下一步清晰可见。</span></h1><p>发现产品灵感，与 Agent 一起探索方向，<br className="tech-desktop-break"/>把值得发生的想法，逐步变成作品。</p><div className="tech-hero-actions"><a className="ip-btn green" href="#agent">开始与 Agent 共创 <span aria-hidden="true">↗</span></a><a className="tech-secondary" href="#discover">探索产品灵感 <span aria-hidden="true">→</span></a></div><span className="tech-caption">灵感发现 <i/> 共同研究 <i/> 创作准备</span></div>
    <span className="tech-art-label">概念视觉 · AI 生成</span>
  </section>
}

export function TechCore() {
  const ref = useMotionVisibility<HTMLDivElement>()
  return <div ref={ref} className="tech-core" aria-hidden="true"><VisualImage src="/inspiration/agent-core-v1.webp"/><span/></div>
}

export function MotionToast({ message, children }: { message: string; children: ReactNode }) {
  const [visible, setVisible] = useState(message)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (message) { setVisible(message); setLeaving(false); return }
    setLeaving(true)
    const timer = setTimeout(() => setVisible(''), 160)
    return () => clearTimeout(timer)
  }, [message])
  return visible ? <div className="ip-toast motion-toast" data-leaving={leaving} role="status"><span>{visible}</span>{children}</div> : null
}
