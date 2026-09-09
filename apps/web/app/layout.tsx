import type { ReactNode } from 'react'
import './tokens.css'
import './globals.css'
import './inspiration.css'
import './studio.css'
import './campaign.css'
import './workspace-design.css'
import './agent-runtime.css'
import './visual-effects.css'

export const metadata = {
  title: 'Supply 灵感 — 好想法，值得发生',
  description: '发现值得发生的产品灵感，遇见认真创造的人。分享想法、参与成长，连接让好产品落地的伙伴。',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('supply.theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}" }} />
        {children}
      </body>
    </html>
  )
}
