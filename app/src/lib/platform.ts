// Runtime detection + app lifecycle hooks for Electron (Windows) and Capacitor (iPad)
import { flushAll } from './sync'

interface ElectronBridge {
  isElectron: true
  onBeforeClose: (cb: () => Promise<void>) => void
}

declare global {
  interface Window {
    aniplayer?: ElectronBridge
    Capacitor?: { isNativePlatform(): boolean; getPlatform(): string }
  }
}

export const isElectron = !!window.aniplayer?.isElectron
export const isNative = !!window.Capacitor?.isNativePlatform?.()
export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isTouch = matchMedia('(pointer: coarse)').matches

type Saver = () => void
const savers = new Set<Saver>()

/** components register a function that writes their in-flight state (e.g. player position) */
export function onAppHide(fn: Saver) {
  savers.add(fn)
  return () => void savers.delete(fn)
}

function saveAll() {
  savers.forEach((s) => {
    try {
      s()
    } catch (e) {
      console.error(e)
    }
  })
}

export function initLifecycle() {
  // iPad: switching apps / locking hides the page; desktop: minimizing or closing the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveAll()
      void flushAll()
    }
  })
  window.addEventListener('pagehide', () => {
    saveAll()
    void flushAll()
  })
  // Electron holds the window open until the final write is confirmed
  window.aniplayer?.onBeforeClose(async () => {
    saveAll()
    await flushAll(3000)
  })
}
