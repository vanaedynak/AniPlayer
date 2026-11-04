// Runtime detection + app lifecycle hooks for Electron (Windows) and Capacitor (iPad)
import { StatusBar, Style } from '@capacitor/status-bar'
import { flushAll } from './sync'
import { paletteById, paletteVars } from './palettes'
import type { TorrentInfo } from './torrent'

export type UpdateState =
  | { status: 'idle' | 'checking' | 'latest' }
  | { status: 'downloading'; version?: string; percent?: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

interface ElectronBridge {
  isElectron: true
  onBeforeClose: (cb: () => Promise<void>) => void
  setZoom: (factor: number) => void
  fetchImage?: (url: string) => Promise<Uint8Array>
  /** a MyAnimeList page's HTML, read by the main process (no CORS) */
  fetchText?: (url: string) => Promise<string>
  /** starts the F5 voice module if it is installed */
  voice?: { start: () => Promise<{ installed: boolean }> }
  version?: () => Promise<string>
  /** Discord Rich Presence through the desktop Discord app */
  discord?: { setActivity: (appId: string, activity: object | null) => Promise<void> }
  /** anyflow:// links that opened or reached the app */
  onDeepLink?: (cb: (url: string) => void) => () => void
  /** desktop only: streams AniLibria torrents through a local server */
  torrent?: {
    open: (id: number) => Promise<TorrentInfo>
    openMagnet: (uri: string) => Promise<TorrentInfo>
    openFile: (bytes: Uint8Array) => Promise<TorrentInfo>
    stats: (hash: string, index: number) => Promise<{ peers: number; down: number; progress: number } | null>
    drop: (hash: string) => Promise<void>
    /** downloads bytes [from, to] of a file ahead of playback */
    warm: (hash: string, index: number, from: number, to: number) => Promise<void>
    /** share of bytes [from, to] already downloaded, 0..1 */
    ready: (hash: string, index: number, from: number, to: number) => Promise<number>
  }
  updates?: {
    get: () => Promise<UpdateState>
    check: () => void
    install: () => void
    onChange: (cb: (s: UpdateState) => void) => () => void
  }
}

declare global {
  const __APP_VERSION__: string
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
/** the site in a browser, not one of the apps */
export const isWeb = !window.aniplayer?.isElectron && !isNative
/** the site opened from a home-screen icon: no browser bars, like an app */
export const isStandalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

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

/** the color theme lives on <html>; the CSS swaps the color tokens */
export function applyTheme(theme: string | undefined) {
  const p = paletteById(theme)
  const root = document.documentElement
  root.dataset.theme = p.id
  for (const [k, v] of Object.entries(paletteVars(p))) root.style.setProperty(k, v)
  // the phone's status bar and the browser's address bar follow the background
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg)
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
