export type SessionUser = { id: string; email: string; name: string; role: 'creator' | 'admin' }
export type CommunityComment = { id: string; projectId: string; authorId: string; authorName: string; text: string; date: string; parentId: string | null }
export type CommunityApplication = {
  id: string; projectId: string; applicantId: string; applicantName: string
  kind: 'tester' | 'collab'; message: string; status: 'pending' | 'accepted' | 'declined'; createdAt: string; response: string
}
export type CommunityNotification = { id: string; title: string; body: string; href: string; read: boolean; createdAt: string }
