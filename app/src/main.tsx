import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSync } from './lib/sync'
import { initLibriaIndex } from './lib/libriaIndex'
import { initLifecycle, initScale, applyScale, initStatusBar } from './lib/platform'
import { useStore } from './lib/store'
import { initMangaSync } from './manga/store'
import { initVault } from './lib/vault'

// keys and the account come back from the device's keychain first (a fresh install on the iPad)
void initVault().finally(initSync)
initLibriaIndex()
initMangaSync()
initLifecycle()
initStatusBar()
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
