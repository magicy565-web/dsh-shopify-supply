import type { ProcurementSnapshot } from './types.js'

export class ProcurementValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid procurement data: ${issues.join('; ')}`)
    this.name = 'ProcurementValidationError'
  }
}

export function validateProcurementSnapshot(value: unknown): ProcurementSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    throw new ProcurementValidationError(['version must be 1'])
  }
  const record = value as Record<string, unknown>
  const names = ['cases', 'candidates', 'quoteRequests', 'quoteRequestItems', 'decisions'] as const
  const issues = names.filter((name) => !Array.isArray(record[name])).map((name) => `${name} must be an array`)
  if (issues.length > 0) throw new ProcurementValidationError(issues)
  const snapshot = value as ProcurementSnapshot
  const caseIds = new Set(snapshot.cases.map((item) => item.id))
  const quoteIds = new Set(snapshot.quoteRequests.map((item) => item.id))
  const duplicate = (values: string[], label: string): void => {
    if (new Set(values).size !== values.length) issues.push(`${label} contains duplicates`)
  }
  duplicate(snapshot.cases.map((item) => item.id), 'cases.id')
  duplicate(snapshot.candidates.map((item) => `${item.sourcingCaseId}:${item.productId}`), 'candidates')
  duplicate(snapshot.quoteRequests.map((item) => item.id), 'quoteRequests.id')
  duplicate(snapshot.quoteRequestItems.map((item) => `${item.quoteRequestId}:${item.offerId}`), 'quoteRequestItems')
  duplicate(snapshot.decisions.map((item) => item.id), 'decisions.id')
  for (const item of snapshot.candidates) if (!caseIds.has(item.sourcingCaseId)) issues.push(`candidate references unknown case ${item.sourcingCaseId}`)
  for (const item of snapshot.quoteRequests) if (!caseIds.has(item.sourcingCaseId)) issues.push(`quote request ${item.id} references unknown case`)
  for (const item of snapshot.quoteRequestItems) if (!quoteIds.has(item.quoteRequestId)) issues.push(`quote item references unknown request ${item.quoteRequestId}`)
  for (const item of snapshot.decisions) if (!caseIds.has(item.sourcingCaseId)) issues.push(`decision ${item.id} references unknown case`)
  if (issues.length > 0) throw new ProcurementValidationError(issues)
  return structuredClone(snapshot)
}
