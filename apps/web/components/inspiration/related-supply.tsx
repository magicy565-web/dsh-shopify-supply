'use client'

import { useEffect, useState } from 'react'
import type { CatalogProduct, CatalogSearchResult } from '@dsh-supply/catalog'
import { api } from '../../lib/api'
import { catalogQueryForIdea } from '../../lib/catalog-match'
import { workspaceHref, type Project } from '../../lib/inspiration'
import { Icon, ProductArt } from '../ui'
import { price } from '../offer-card'

export function RelatedSupply({ project }: { project: Project }) {
  const [items, setItems] = useState<CatalogProduct[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'offline'>('loading')
  const query = catalogQueryForIdea(project)
  const href = workspaceHref(project)

  useEffect(() => {
    let cancelled = false
    if (!query) { setItems([]); setStatus('empty'); return }
    setStatus('loading')
    void api<CatalogSearchResult>(`/v1/catalog/products?${new URLSearchParams({ query, limit: '3' })}`)
      .then(result => {
        if (cancelled) return
        const matches = result.items.slice(0, 3)
        setItems(matches)
        setStatus(matches.length ? 'ready' : 'empty')
      })
      .catch(() => { if (!cancelled) { setItems([]); setStatus('offline') } })
    return () => { cancelled = true }
  }, [query, project.id])

  return (
    <section className="ip-supply-band">
      <div className="ip-container">
        <div className="ip-section-heading">
          <div>
            <span className="ip-eyebrow">FROM IDEA TO SUPPLY</span>
            <h2>先看看，有没有相近的供货</h2>
          </div>
          <a href={href} className="ip-text-link">去供应链工作台 <Icon name="chevron" size={15} /></a>
        </div>
        {status === 'loading' && (
          <div className="ip-supply-grid" role="status" aria-label="正在对照供货目录">
            {[0, 1, 2].map(i => <div key={i} className="ui-skel ip-supply-skel" />)}
          </div>
        )}
        {status === 'offline' && <p className="ip-inline-empty ip-supply-status">供货服务暂时连不上。仍可以把这个想法带到工作台，稍后再匹配。</p>}
        {status === 'empty' && <p className="ip-inline-empty ip-supply-status">目录里还没有直接对应「{project.name}」的商品。到工作台描述需求，或浏览现有供货。</p>}
        {status === 'ready' && (
          <div className="ip-supply-grid">
            {items.map(product => {
              const offer = product.offers[0]
              return (
                <article key={product.id} className="ip-supply-card">
                  <ProductArt title={product.title} category={product.category} image={product.images[0]} />
                  <div className="ip-supply-card-body">
                    <span>{product.category}</span>
                    <strong>{product.title}</strong>
                    <p>{offer ? `${price(offer.unitPrice, offer.currency)} · 起订 ${offer.moq} 件 · 交期 ${offer.leadTimeDays} 天` : '暂无报价'}</p>
                    <a className="ip-btn light" href={href}>在工作台查看 <Icon name="chevron" size={13} /></a>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <p className="ip-example-note ui-disclaimer">相近供货来自当前商品库，不代表这个灵感已经有现成量产商品。</p>
      </div>
    </section>
  )
}
