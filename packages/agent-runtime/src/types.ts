import type {
  AgentEvent,
  AgentMessage,
  AgentSession,
  ApprovalDecision,
  CreateSessionInput,
  SessionState,
} from '@dsh-supply/agent-contracts'

export interface AgentRuntime {
  createSession(input?: CreateSessionInput): Promise<AgentSession>
  sendMessage(sessionId: string, message: AgentMessage): AsyncIterable<AgentEvent>
  approve(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<void>
  abort(sessionId: string): Promise<void>
  resume(sessionId: string): Promise<void>
  getSession(sessionId: string): Promise<SessionState>
  close(sessionId: string): Promise<void>
}
