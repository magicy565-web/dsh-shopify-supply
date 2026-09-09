import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createGatewayApp } from '@dsh-supply/agent-gateway/app'
import { InMemoryAgentRuntime } from '@dsh-supply/agent-runtime'
import type { AgentEvent } from '@dsh-supply/agent-contracts'
import { CatalogService, InMemoryCatalogRepository } from '@dsh-supply/catalog'
import { CommerceService, FixtureShopifyStore, InMemoryCommerceRepository } from '@dsh-supply/commerce'
import { InMemoryProcurementRepository, ProcurementService } from '@dsh-supply/procurement'
import { sampleCatalog } from './sourcing-loop.js'

async function listen(handle: ReturnType<typeof createGatewayApp>['handle']): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handle(req, res)
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP listen address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

function parseSse(text: string): AgentEvent[] {
  return text.split(/\r?\n\r?\n/).flatMap((frame) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    return data ? [JSON.parse(data) as AgentEvent] : []
  })
}

function app(runtime = new InMemoryAgentRuntime(), internalToken?: string) {
  const catalog = new CatalogService(new InMemoryCatalogRepository(sampleCatalog()))
  const procurement = new ProcurementService(new InMemoryProcurementRepository(), catalog)
  const commerce = new CommerceService(new InMemoryCommerceRepository(), catalog, procurement, new FixtureShopifyStore())
  return createGatewayApp({
    runtime,
    catalog,
    procurement,
    commerce,
    storage: 'json',
    origin: '*',
    runtimeKind: 'in-memory',
    internalToken,
  })
}

test('gateway recreates an unknown session on the next message', async () => {
  const server = await listen(app().handle)
  try {
    const response = await fetch(`${server.url}/v1/sessions/session-recovered/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })
    assert.equal(response.status, 200)
    const events = parseSse(await response.text())
    assert.ok(events.some((event) => event.type === 'message.delta'))
    assert.equal(events.at(-1)?.type, 'agent.completed')
  } finally {
    await server.close()
  }
})

test('gateway close and later message recreates the session', async () => {
  const server = await listen(app().handle)
  try {
    const created = await (await fetch(`${server.url}/v1/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).json() as { id: string }
    const closed = await fetch(`${server.url}/v1/sessions/${created.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(closed.status, 200)
    const response = await fetch(`${server.url}/v1/sessions/${created.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })
    const events = parseSse(await response.text())
    assert.ok(events.some((event) => event.type === 'message.delta'))
  } finally {
    await server.close()
  }
})

test('gateway write routes are idempotent for the same key', async () => {
  const server = await listen(app().handle)
  try {
    const payload = {
      title: 'US bottle',
      query: 'bottle',
      quantity: 24,
      destinationCountry: 'US',
    }
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'tool-call-1' }
    const first = await (await fetch(`${server.url}/v1/sourcing/cases`, { method: 'POST', headers, body: JSON.stringify(payload) })).json() as { id: string }
    const second = await (await fetch(`${server.url}/v1/sourcing/cases`, { method: 'POST', headers, body: JSON.stringify(payload) })).json() as { id: string }
    assert.equal(first.id, second.id)
    const conflict = await fetch(`${server.url}/v1/sourcing/cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'tool-call-1' },
      body: JSON.stringify({ ...payload, title: 'different' }),
    })
    assert.equal(conflict.status, 409)
    const listed = await (await fetch(`${server.url}/v1/sourcing/cases`)).json() as { items: unknown[] }
    assert.equal(listed.items.length, 1)
  } finally {
    await server.close()
  }
})

test('plugin requests without the internal token are rejected', async () => {
  const server = await listen(app(new InMemoryAgentRuntime(), 'gateway-secret').handle)
  try {
    const denied = await fetch(`${server.url}/v1/catalog/products`, {
      headers: { 'x-dsh-plugin': '1' },
    })
    assert.equal(denied.status, 401)
    const allowed = await fetch(`${server.url}/v1/catalog/products`, {
      headers: { authorization: 'Bearer gateway-secret', 'x-dsh-plugin': '1' },
    })
    assert.equal(allowed.status, 200)
    const browser = await fetch(`${server.url}/v1/catalog/products`)
    assert.equal(browser.status, 200)
  } finally {
    await server.close()
  }
})
