import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './styles/design-system.css'
// 统一加载现有 styles/*.css（复用原版样式，保证 UI 一致）
import './styles/main.css'
import './styles/global-shortcuts.css'
import './styles/subscription.css'
import './styles/user-center.css'
import './styles/account-menu.css'
import './styles/user-management.css'
import './styles/system-settings.css'
import './styles/file-manager.css'
import './styles/file-manager-organize.css'
import './styles/question-bank-admin.css'
import './styles/question-training.css'
import './styles/knowledge-recall.css'
import './styles/graph-file-tabs.css'
import './styles/graph-user-preferences.css'
import './styles/home-file-library.css'
import './styles/boardmix-overrides.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
