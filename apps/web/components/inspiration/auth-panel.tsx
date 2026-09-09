'use client'

import { useState, type FormEvent } from 'react'
import { api, writeToken } from '../../lib/api'
import type { SessionUser } from '../../lib/session'

export function AuthPanel({ onAuthed, onClose }: { onAuthed: (user: SessionUser) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const path = mode === 'login' ? '/v1/community/login' : '/v1/community/register'
      const body = mode === 'login' ? { email, password } : { email, password, name }
      const result = await api<{ user: SessionUser; token: string }>(path, body)
      writeToken(result.token)
      onAuthed(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ip-auth-backdrop" role="presentation" onClick={onClose}>
      <section className="ip-auth-card" role="dialog" aria-labelledby="auth-title" onClick={e => e.stopPropagation()}>
        <button className="ip-text-link ip-auth-close" onClick={onClose}>关闭</button>
        <span className="ip-eyebrow">ACCOUNT</span>
        <h2 id="auth-title">{mode === 'login' ? '登录后，继续你的项目' : '创建一个创作者账号'}</h2>
        <p>项目、图片、评论和申请都会保存在账号里。换设备后登录即可继续。当前不涉及付款。</p>
        <div className="ip-space-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
        </div>
        <form onSubmit={e => void submit(e)}>
          {mode === 'register' && <label>显示名称<input required maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="创作者或工作室名称" /></label>}
          <label>邮箱<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label>
          <label>密码<input required type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少 8 个字符" /></label>
          {error && <p className="ip-form-error" role="alert">{error}</p>}
          <button className="ip-btn green wide" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}</button>
        </form>
        <p className="ip-support-note">管理员审核后台使用独立账号。默认管理员：admin@supply.local</p>
      </section>
    </div>
  )
}
