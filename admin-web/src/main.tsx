import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Remove one-time deploy-refresh query param after hard reload (see vite-plugin-deploy-refresh).
{
  const url = new URL(window.location.href)
  if (url.searchParams.has('_yhgc_deploy')) {
    url.searchParams.delete('_yhgc_deploy')
    const next = url.pathname + url.search + url.hash
    window.history.replaceState({}, '', next)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
