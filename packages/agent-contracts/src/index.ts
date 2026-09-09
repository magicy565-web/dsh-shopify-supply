export type AgentMessage = {
  role: 'user'
  text: string
}

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'aborted'
  | 'closed'

export type AgentSession = {
  id: string
  createdAt: string
}

export type CreateSessionInput = {
  id?: string
}

export type SessionState = {
  id: string
  status: SessionStatus
  pendingApprovalId?: string
  pendingApprovalIds?: string[]
  tools: string[]
}

export const AGENT_ERROR_CODES = [
  'session.unknown',
  'session.closed',
  'session.aborted',
  'session.busy',
  'approval.unknown',
  'approval.expired',
  'auth.unauthorized',
  'idempotency.conflict',
] as const

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number]

export class AgentError extends Error {
  readonly code: AgentErrorCode

  constructor(code: AgentErrorCode, message: string) {
    super(message)
    this.name = 'AgentError'
    this.code = code
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError
}

export type ApprovalDecision = 'allow' | 'deny'

type EventBase = {
  sessionId: string
  ts: string
}

export type MessageDeltaEvent = EventBase & {
  type: 'message.delta'
  text: string
}

export type ToolStartedEvent = EventBase & {
  type: 'tool.started'
  toolCallId: string
  toolName: string
  arguments?: unknown
}

export type ToolCompletedEvent = EventBase & {
  type: 'tool.completed'
  toolCallId: string
  toolName: string
  isError: boolean
  result: unknown
}

export type ApprovalRequestedEvent = EventBase & {
  type: 'approval.requested'
  approvalId: string
  toolName: string
  toolCallId?: string
  reason?: string
  arguments?: unknown
}

export type ApprovalResolvedEvent = EventBase & {
  type: 'approval.resolved'
  approvalId: string
  decision: ApprovalDecision
  outcome: string
}

export type AgentCompletedEvent = EventBase & {
  type: 'agent.completed'
}

export type AgentFailedEvent = EventBase & {
  type: 'agent.failed'
  message: string
  code?: AgentErrorCode
}

export type AgentEvent =
  | MessageDeltaEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | AgentCompletedEvent
  | AgentFailedEvent

export const AGENT_EVENT_TYPES = [
  'message.delta',
  'tool.started',
  'tool.completed',
  'approval.requested',
  'approval.resolved',
  'agent.completed',
  'agent.failed',
] as const
