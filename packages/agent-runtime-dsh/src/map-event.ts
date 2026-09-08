import type { AgentEvent } from '@dsh-supply/agent-contracts'

type Notification = {
  method: string
  params: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ts(): string {
  return new Date().toISOString()
}

function eventType(event: Record<string, unknown>): string {
  return typeof event.type === 'string' ? event.type : ''
}

function dataOf(event: Record<string, unknown>): Record<string, unknown> {
  return isRecord(event.data) ? event.data : event
}

function textFromChunk(data: Record<string, unknown>): string | undefined {
  const chunk = data.chunk
  if (isRecord(chunk) && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
    return chunk.text
  }
  if (typeof data.text === 'string') return data.text
  return undefined
}

function toolCallFields(data: Record<string, unknown>): {
  toolCallId: string
  toolName: string
  arguments?: unknown
} {
  const call = isRecord(data.call) ? data.call : data
  const toolCallId = String(call.id ?? call.callId ?? data.callId ?? '')
  const toolName = String(call.name ?? call.toolName ?? data.name ?? data.toolName ?? 'unknown')
  const rawArgs = call.arguments ?? data.arguments
  let args = rawArgs
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs) as unknown
    } catch {
      // Preserve malformed provider arguments for diagnostics.
    }
  }
  return { toolCallId, toolName, arguments: args }
}

function failureFromChunk(data: Record<string, unknown>): string | undefined {
  const chunk = isRecord(data.chunk) ? data.chunk : undefined
  if (chunk?.type !== 'finish' || !isRecord(chunk.reason)) return undefined
  if (chunk.reason.kind !== 'error' && chunk.reason.kind !== 'aborted') return undefined
  const failure = isRecord(chunk.reason.failure) ? chunk.reason.failure : undefined
  if (typeof failure?.message === 'string') return failure.message
  if (typeof failure?.code === 'string') return failure.code
  return `agent ${chunk.reason.kind}`
}

function toolResultFields(
  data: Record<string, unknown>,
  toolNames?: Map<string, string>,
): {
  toolCallId: string
  toolName: string
  isError: boolean
  result: unknown
} {
  const message = isRecord(data.message) ? data.message : undefined
  const content = Array.isArray(message?.content) ? message.content : []
  const block = content.find((value) => isRecord(value) && value.type === 'tool-result')
  const resultBlock = isRecord(block) ? block : undefined
  const toolCallId = String(resultBlock?.toolCallId ?? data.callId ?? data.id ?? '')
  const toolName = String(
    data.name
      ?? data.toolName
      ?? toolNames?.get(toolCallId)
      ?? 'unknown',
  )
  const isError = resultBlock?.isError === true || data.isError === true || data.error !== undefined
  const result = resultBlock?.content ?? data.result ?? data.content ?? data.value ?? data
  return { toolCallId, toolName, isError, result }
}

export function mapNotification(
  notification: Notification,
  sessionId: string,
  toolNames?: Map<string, string>,
): AgentEvent[] {
  if (notification.method === 'session.status') {
    const status = notification.params.status
    const sid = String(notification.params.sessionId ?? sessionId)
    if (status === 'idle' && sid === sessionId) {
      return [{ type: 'agent.completed', sessionId, ts: ts() }]
    }
    return []
  }

  if (notification.method !== 'session.event') return []
  const sid = String(notification.params.sessionId ?? sessionId)
  if (sid !== sessionId) return []
  const event = notification.params.event
  if (!isRecord(event)) return []
  return mapSessionEvent(event, sessionId, toolNames)
}

export function mapSessionEvent(
  event: Record<string, unknown>,
  sessionId: string,
  toolNames?: Map<string, string>,
): AgentEvent[] {
  const type = eventType(event)
  const data = dataOf(event)
  const stamp = { sessionId, ts: ts() }

  if (type === 'assistant/chunk') {
    const failure = failureFromChunk(data)
    if (failure) return [{ ...stamp, type: 'agent.failed', message: failure }]
    const text = textFromChunk(data)
    if (!text) return []
    return [{ ...stamp, type: 'message.delta', text }]
  }

  if (type === 'tool/call') {
    const fields = toolCallFields(data)
    toolNames?.set(fields.toolCallId, fields.toolName)
    return [{
      ...stamp,
      type: 'tool.started',
      toolCallId: fields.toolCallId,
      toolName: fields.toolName,
      arguments: fields.arguments,
    }]
  }

  if (type === 'tool/result') {
    const fields = toolResultFields(data, toolNames)
    toolNames?.delete(fields.toolCallId)
    return [{
      ...stamp,
      type: 'tool.completed',
      toolCallId: fields.toolCallId,
      toolName: fields.toolName,
      isError: fields.isError,
      result: fields.result,
    }]
  }

  if (type === 'approval/asked') {
    const approvalId = String(data.id ?? '')
    const toolName = String(data.toolName ?? 'unknown')
    const toolCallId = typeof data.callId === 'string' ? data.callId : undefined
    const reason = typeof data.reason === 'string' ? data.reason : undefined
    return [{
      ...stamp,
      type: 'approval.requested',
      approvalId,
      toolName,
      toolCallId,
      reason,
    }]
  }

  if (type === 'approval/decided') {
    const approvalId = String(data.id ?? '')
    const outcome = String(data.outcome ?? '')
    const decision = outcome === 'allowed-once' ? 'allow' : 'deny'
    return [{
      ...stamp,
      type: 'approval.resolved',
      approvalId,
      decision,
      outcome,
    }]
  }

  return []
}

export function isInboxReceipt(event: unknown, messageId: string): boolean {
  if (!isRecord(event) || event.type !== 'agent/inbox/spliced' || !isRecord(event.data)) return false
  const inserted = event.data.inserted
  return Array.isArray(inserted)
    && inserted.some((message) => isRecord(message) && message.id === messageId)
}
