import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSync } from './lib/sync'
import { initLifecycle, initScale, applyScale } from './lib/platform'
import { useStore } from './lib/store'

initSync()
initLifecycle()
initScale(
  () => useStore.getState().local.scale,
  (scale) => useStore.getState().setLocal({ scale }),
)
useStore.subscribe((s, prev) => s.local.scale !== prev.local.scale && applyScale(s.local.scale))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
