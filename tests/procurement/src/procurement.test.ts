import assert from 'node:assert/strict'
import test from 'node:test'
import { ProcurementInputError } from '@dsh-supply/procurement'
import { memoryProcurement, assertSourcingClosedLoop } from './sourcing-loop.js'

test('sourcing case progresses through candidate, quote draft, and human approval', async () => {
  const { procurement } = memoryProcurement()
  const approved = await assertSourcingClosedLoop(procurement)
  assert.equal(approved.decisions[0]?.decidedBy, 'operator@example.test')
})

test('candidate add is idempotent and updates rationale', async () => {
  const { procurement } = memoryProcurement()
  const created = await procurement.createCase({
    title: 'Sleeve sourcing',
    requirements: { query: 'sleeve', quantity: 20, destinationCountry: 'US' },
  })
  await procurement.addCandidate(created.id, 'LB-210', 'First reason')
  const updated = await procurement.addCandidate(created.id, 'LB-210', 'Updated reason')
  assert.equal(updated.candidates.length, 1)
  assert.equal(updated.candidates[0]?.rationale, 'Updated reason')
})

test('quote draft rejects an offer outside the case candidates', async () => {
  const { procurement } = memoryProcurement()
  const created = await procurement.createCase({
    title: 'Bottle sourcing',
    requirements: { query: 'bottle', quantity: 25, destinationCountry: 'US' },
  })
  await procurement.addCandidate(created.id, 'WB-100')
  await assert.rejects(() => procurement.draftQuoteRequest(created.id, {
    supplierId: 'supplier-sup-c',
    offerIds: ['offer-lb-210-sup-c-lb-210-nat'],
    quantity: 25,
  }), ProcurementInputError)
})

test('approved sourcing case is immutable', async () => {
  const { procurement } = memoryProcurement()
  await assertSourcingClosedLoop(procurement)
})

test('parallel candidate writes keep both products', async () => {
  const { procurement } = memoryProcurement()
  const created = await procurement.createCase({
    title: 'Mixed sourcing',
    requirements: { query: 'mixed', quantity: 20, destinationCountry: 'US' },
  })
  await Promise.all([
    procurement.addCandidate(created.id, 'WB-100', 'Bottle'),
    procurement.addCandidate(created.id, 'LB-210', 'Sleeve'),
  ])
  const view = await procurement.getCase(created.id)
  assert.equal(view.candidates.length, 2)
  assert.deepEqual(view.candidates.map((item) => item.product.sku).sort(), ['LB-210', 'WB-100'])
})
