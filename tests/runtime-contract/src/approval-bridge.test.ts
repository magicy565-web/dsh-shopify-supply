import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApprovalBridge } from '@dsh-supply/agent-runtime-dsh'

const token = 'bridge-secret'

async function wait(url: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return fetch(`${url}/wait`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
}

test('approval bridge requires the internal token', async () => {
  const bridge = new ApprovalBridge({ token, timeoutMs: 200 })
  const url = await bridge.start()
  try {
    const denied = await fetch(`${url}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', callId: 'c1' }),
    })
    assert.equal(denied.status, 401)
    const json = await denied.json() as { outcome?: string }
    assert.equal(json.outcome, 'unavailable')
  } finally {
    await bridge.stop()
  }
})

test('approval bridge resolves two waits independently', async () => {
  const bridge = new ApprovalBridge({ token, timeoutMs: 2000 })
  const url = await bridge.start()
  try {
    const first = wait(url, { sessionId: 's1', callId: 'c1' })
    const second = wait(url, { sessionId: 's1', callId: 'c2' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    bridge.bindApproval('s1', 'a1', 'c1')
    bridge.bindApproval('s1', 'a2', 'c2')
    bridge.resolve('s1', 'a1', 'allow')
    bridge.resolve('s1', 'a2', 'deny')
    assert.deepEqual(await (await first).json(), { outcome: 'allowed-once' })
    assert.deepEqual(await (await second).json(), { outcome: 'rejected' })
  } finally {
    await bridge.stop()
  }
})

test('approval bridge bind-before-wait still delivers the decision', async () => {
  const bridge = new ApprovalBridge({ token, timeoutMs: 2000 })
  const url = await bridge.start()
  try {
    bridge.bindApproval('s1', 'a1', 'c1')
    bridge.resolve('s1', 'a1', 'allow')
    const response = await wait(url, { sessionId: 's1', callId: 'c1' })
    assert.deepEqual(await response.json(), { outcome: 'allowed-once' })
  } finally {
    await bridge.stop()
  }
})

test('approval bridge ttl fail-closes', async () => {
  const bridge = new ApprovalBridge({ token, timeoutMs: 40 })
  const url = await bridge.start()
  try {
    const response = await wait(url, { sessionId: 's1', callId: 'late' })
    assert.deepEqual(await response.json(), { outcome: 'cancelled' })
  } finally {
    await bridge.stop()
  }
})
