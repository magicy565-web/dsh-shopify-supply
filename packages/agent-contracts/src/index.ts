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
  tools: string[]
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
