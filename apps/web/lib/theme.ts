export const THEME_KEY = 'supply.theme'
export const IDEA_KEY = 'supply.idea-context.v1'
export const IDEA_DISMISS_KEY = 'supply.idea-context.dismissed'

export type Theme = 'light' | 'dark'
export type IdeaContext = { name: string; from?: string; need?: string }

export function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* Theme still applies for this session. */ }
}
export function readIdeaContext(): IdeaContext | undefined {
  try {
    const raw = sessionStorage.getItem(IDEA_KEY)
    if (!raw) return
    const value = JSON.parse(raw) as Partial<IdeaContext>
    if (typeof value.name !== 'string' || !value.name.trim()) return
    return {
      name: value.name.trim(),
      from: typeof value.from === 'string' ? value.from : undefined,
      need: typeof value.need === 'string' ? value.need : undefined,
    }
  } catch { return }
}
export function writeIdeaContext(idea: IdeaContext) {
  try {
    sessionStorage.setItem(IDEA_KEY, JSON.stringify(idea))
    sessionStorage.removeItem(IDEA_DISMISS_KEY)
  } catch { /* Idea context still lives in component state. */ }
}
export function dismissIdeaContext() {
  try { sessionStorage.setItem(IDEA_DISMISS_KEY, '1') } catch { /* Dismiss still applies in memory. */ }
}
export function isIdeaDismissed() {
  try { return sessionStorage.getItem(IDEA_DISMISS_KEY) === '1' } catch { return false }
}
