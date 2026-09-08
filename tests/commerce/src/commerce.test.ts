import assert from 'node:assert/strict'
import test from 'node:test'
import { CommerceInputError } from '@dsh-supply/commerce'
import { approveBottleCase, assertCommerceClosedLoop, memoryStack } from './loop.js'

test('approved case becomes a listing, routes a fixture order, and writes tracking back', async () => {
  const { procurement, commerce } = memoryStack()
  const caseId = await approveBottleCase(procurement)
  const shipped = await assertCommerceClosedLoop(commerce, caseId)
  assert.equal(shipped.purchaseOrders[0]?.supplierId, 'supplier-sup-a')
})

test('unapproved sourcing case cannot be listed', async () => {
  const { procurement, commerce } = memoryStack()
  const created = await procurement.createCase({
    title: 'Not ready',
    requirements: { query: 'bottle', quantity: 25, destinationCountry: 'US' },
  })
  await assert.rejects(() => commerce.createListingsFromCase({ sourcingCaseId: created.id }), CommerceInputError)
})
