// Runtime detection + app lifecycle hooks for Electron (Windows) and Capacitor (iPad)
import { StatusBar, Style } from '@capacitor/status-bar'
import { flushAll } from './sync'

export type UpdateState =
  | { status: 'idle' | 'checking' | 'latest' }
  | { status: 'downloading'; version?: string; percent?: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

interface ElectronBridge {
  isElectron: true
  onBeforeClose: (cb: () => Promise<void>) => void
  setZoom: (factor: number) => void
  version?: () => Promise<string>
  updates?: {
    get: () => Promise<UpdateState>
    check: () => void
    install: () => void
    onChange: (cb: (s: UpdateState) => void) => () => void
  }
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

/** writes everything in flight, then lets Electron restart into the downloaded update */
export async function installUpdate() {
  saveAll()
  await flushAll(3000)
  window.aniplayer?.updates?.install()
}

/** iPad: the status bar (clock, battery) hides while any player is fullscreen, ours or Kodik's */
export function initStatusBar() {
  if (!isNative) return
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  const doc = document as Document & { webkitFullscreenElement?: Element }
  const sync = (full: boolean) => void (full ? StatusBar.hide() : StatusBar.show()).catch(() => {})
  const onChange = () => sync(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
  document.addEventListener('fullscreenchange', onChange)
  document.addEventListener('webkitfullscreenchange', onChange)
  // native video fullscreen (webkitEnterFullscreen) fires on the video element itself
  document.addEventListener('webkitbeginfullscreen', () => sync(true), true)
  document.addEventListener('webkitendfullscreen', () => sync(false), true)
}

export const SCALES = [0.75, 0.85, 0.9, 1, 1.1, 1.25]

/** interface scale: Electron zooms natively, iPad/browser use CSS zoom */
export function applyScale(scale: number) {
  if (window.aniplayer?.setZoom) window.aniplayer.setZoom(scale)
  else document.documentElement.style.setProperty('zoom', String(scale))
}

export function initScale(get: () => number, set: (s: number) => void) {
  applyScale(get())
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const i = SCALES.indexOf(get())
    const cur = i < 0 ? SCALES.indexOf(1) : i
    if (e.key === '=' || e.key === '+') set(SCALES[Math.min(SCALES.length - 1, cur + 1)])
    else if (e.key === '-') set(SCALES[Math.max(0, cur - 1)])
    else if (e.key === '0') set(1)
    else return
    e.preventDefault()
  })
}
