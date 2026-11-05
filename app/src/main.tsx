import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSync } from './lib/sync'
import { initLibriaIndex } from './lib/libriaIndex'
import { initLifecycle, initScale, applyScale, applyTheme, initStatusBar } from './lib/platform'
import { useStore } from './lib/store'
import { initMangaSync } from './manga/store'
import { initUpdates } from './manga/updates'
import { initVault } from './lib/vault'

// keys and the account come back from the device's keychain first (a fresh install on the iPad)
void initVault().finally(initSync)
initLibriaIndex()
initMangaSync()
initUpdates()
initLifecycle()
initStatusBar()
initScale(
  () => useStore.getState().local.scale,
  (scale) => useStore.getState().setLocal({ scale }),
)
useStore.subscribe((s, prev) => s.local.scale !== prev.local.scale && applyScale(s.local.scale))
applyTheme(useStore.getState().local.theme)
useStore.subscribe((s, prev) => s.local.theme !== prev.local.theme && applyTheme(s.local.theme))
// the lab copy of the project says so in the window title, so it is never taken for the main app
if (__FLAVOR__.lab) document.title = __FLAVOR__.name

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
