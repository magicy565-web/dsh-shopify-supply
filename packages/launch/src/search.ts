import type { WebSearchHit, WebSearchResult } from './types.js'

export type SearchPublicWeb = (query: string, signal?: AbortSignal) => Promise<WebSearchResult>

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-supply-launch/0.0.1' },
    signal: signal ?? AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`search failed with ${response.status}`)
  return response.json() as Promise<unknown>
}

function wikiUrl(lang: 'zh' | 'en', title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`
}

async function wikipedia(lang: 'zh' | 'en', query: string, signal?: AbortSignal): Promise<WebSearchHit[]> {
  const url = `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '5',
    format: 'json',
    utf8: '1',
  }).toString()}`
  const body = asRecord(await getJson(url, signal))
  const queryNode = asRecord(body?.query)
  const search = Array.isArray(queryNode?.search) ? queryNode.search : []
  return search.flatMap((item): WebSearchHit[] => {
    const row = asRecord(item)
    const title = textOf(row?.title)
    if (!title) return []
    return [{
      title,
      snippet: textOf(row?.snippet),
      url: wikiUrl(lang, title),
      provider: `wikipedia-${lang}`,
    }]
  })
}

function duckHits(body: unknown): WebSearchHit[] {
  const row = asRecord(body)
  if (!row) return []
  const hits: WebSearchHit[] = []
  const abstract = textOf(row.AbstractText)
  const abstractUrl = textOf(row.AbstractURL)
  if (abstract && abstractUrl) {
    hits.push({
      title: textOf(row.Heading) || abstract.slice(0, 80),
      snippet: abstract,
      url: abstractUrl,
      provider: 'duckduckgo',
    })
  }
  const related = Array.isArray(row.RelatedTopics) ? row.RelatedTopics : []
  for (const topic of related) {
    const node = asRecord(topic)
    if (!node) continue
    if (Array.isArray(node.Topics)) {
      for (const nested of node.Topics) {
        const child = asRecord(nested)
        const text = textOf(child?.Text)
        const url = textOf(child?.FirstURL)
        if (text && url) hits.push({ title: text.slice(0, 80), snippet: text, url, provider: 'duckduckgo' })
      }
      continue
    }
    const text = textOf(node.Text)
    const url = textOf(node.FirstURL)
    if (text && url) hits.push({ title: text.slice(0, 80), snippet: text, url, provider: 'duckduckgo' })
  }
  return hits
}

async function duckDuckGo(query: string, signal?: AbortSignal): Promise<WebSearchHit[]> {
  const url = `https://api.duckduckgo.com/?${new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    no_redirect: '1',
    skip_disambig: '1',
  }).toString()}`
  return duckHits(await getJson(url, signal))
}

function unique(hits: WebSearchHit[]): WebSearchHit[] {
  const seen = new Set<string>()
  return hits.filter((hit) => {
    if (!hit.url || seen.has(hit.url)) return false
    seen.add(hit.url)
    return true
  })
}

export const searchPublicWeb: SearchPublicWeb = async (query, signal) => {
  const trimmed = query.trim()
  if (!trimmed) return { query: trimmed, hits: [], error: 'search query is empty' }
  const errors: string[] = []
  const hits: WebSearchHit[] = []
  for (const job of [
    () => wikipedia('zh', trimmed, signal),
    () => wikipedia('en', trimmed, signal),
    () => duckDuckGo(trimmed, signal),
  ]) {
    try {
      hits.push(...await job())
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  const deduped = unique(hits).slice(0, 8)
  if (deduped.length === 0) {
    return { query: trimmed, hits: [], error: errors[0] ?? 'public web search returned no sources' }
  }
  return { query: trimmed, hits: deduped }
}
