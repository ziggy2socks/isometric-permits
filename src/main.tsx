import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import { PermitProvider } from './PermitContext'
import AppShell from './AppShell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PermitProvider>
      <AppShell />
    </PermitProvider>
  </StrictMode>,
)
