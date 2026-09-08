import type { CatalogProduct, HydratedOffer } from '@dsh-supply/catalog'
import { Icon, ProductArt } from './ui'

export const price = (value: number | undefined, currency = 'USD') => value === undefined ? '待确认' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
export type Selection = { product: CatalogProduct; offer: HydratedOffer }
export function OfferCard({ product, saved, demo, onOpen, onSave, onQuote }: { product: CatalogProduct; saved: boolean; demo: boolean; onOpen: (selection: Selection) => void; onSave: () => void; onQuote: (selection: Selection) => void }) {
  const offer = product.offers[0]
  return <article className="offer-card">
    <div className="offer-visual"><ProductArt title={product.title} category={product.category} image={product.images[0]} /><span className="art-label">{demo ? '演示商品' : product.images.length ? product.category : '产品示意'}</span><button className={`save-button icon-button ${saved ? 'saved' : ''}`} onClick={onSave} aria-label={saved ? `取消收藏${product.title}` : `收藏${product.title}`} aria-pressed={saved}><Icon name={saved ? 'check' : 'bookmark'} size={16} /></button></div>
    <div className="offer-body"><span className="overline">{product.category}</span><h3>{product.title}</h3><p className="offer-description">{product.description}</p><div className="offer-price"><strong>{offer ? price(offer.unitPrice, offer.currency) : '暂无报价'}</strong><span>/ 件</span></div><div className="offer-metrics"><span>起订 <b>{offer?.moq ?? '—'} 件</b></span><span>交期 <b>{offer ? `${offer.leadTimeDays} 天` : '待确认'}</b></span></div><div className="offer-actions"><button className="text-button" disabled={!offer} onClick={() => offer && onOpen({ product, offer })}>查看供货详情 <Icon name="chevron" size={13} /></button><button className="small-button" disabled={!offer} onClick={() => offer && onQuote({ product, offer })}>获取报价</button></div></div>
  </article>
}

