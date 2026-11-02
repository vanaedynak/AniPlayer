// Electron shell for Windows. Serves the built app from app://aniplayer so the
// page has a proper secure origin (IndexedDB, Firebase Auth and CORS all behave).
const { app, BrowserWindow, protocol, net, ipcMain, shell, nativeTheme, Menu, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

const DEV_URL = process.env.VITE_DEV_URL
const DIST = path.join(__dirname, '..', 'dist')
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

// the app was called AniPlayer before: its data folder keeps that name, so a renamed app finds
// the history, downloads and logins where they always were
app.setPath('userData', path.join(app.getPath('appData'), 'aniplayer'))

if (!app.requestSingleInstanceLock()) app.quit()

nativeTheme.themeSource = 'dark'
// no default menu: its zoom shortcuts would fight the in-app scale setting
Menu.setApplicationMenu(null)
let win = null
let updating = false

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { width: 1440, height: 900 }
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return
  const s = { ...win.getNormalBounds(), maximized: win.isMaximized() }
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s))
  } catch {}
}

function createWindow() {
  const state = loadState()
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#060a0f',
    title: 'Anyflow Desktop',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 56 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  })
  if (state.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // links with target=_blank (AniList, Firebase console) open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // hold the window until the page confirms its last progress write
  let closing = false
  win.on('close', (e) => {
    saveState()
    if (closing || updating) return
    e.preventDefault()
    closing = true
    win.webContents.send('before-close')
    setTimeout(() => win && !win.isDestroyed() && win.destroy(), 4000)
  })
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false))
  // a page leaving fullscreen (or losing its fullscreen element) never leaves the window stuck fullscreen
  let fullBeforeVideo = false
  win.webContents.on('enter-html-full-screen', () => (fullBeforeVideo = win.isFullScreen()))
  win.webContents.on('leave-html-full-screen', () => {
    if (win && !win.isDestroyed() && win.isFullScreen() && !fullBeforeVideo) win.setFullScreen(false)
  })

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadURL('app://aniplayer/index.html')
}

// updates: CI publishes the installer + latest.yml to the rolling GitHub release (see package.json "publish").
// Downloads run in the background; the page shows a button once the new version is ready.
let updateState = { status: 'idle' }
function setUpdate(s) {
  updateState = s
  if (win && !win.isDestroyed()) win.webContents.send('update-state', s)
}

function checkForUpdates() {
  if (!app.isPackaged) return setUpdate({ status: 'error', message: 'Обновления работают только в установленной версии' })
  if (updateState.status === 'downloading' || updateState.status === 'ready') return
  autoUpdater.checkForUpdates().catch((e) => setUpdate({ status: 'error', message: String(e?.message ?? e) }))
}

function initUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => setUpdate({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'latest' }))
  autoUpdater.on('update-available', (i) => setUpdate({ status: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => setUpdate({ ...updateState, status: 'downloading', percent: p.percent }))
  autoUpdater.on('update-downloaded', (i) => setUpdate({ status: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => setUpdate({ status: 'error', message: String(e?.message ?? e) }))
  if (!app.isPackaged) return
  setTimeout(checkForUpdates, 5000)
  setInterval(checkForUpdates, 2 * 60 * 60 * 1000)
}

ipcMain.handle('app-version', () => app.getVersion())
ipcMain.handle('update-state', () => updateState)
ipcMain.on('update-check', checkForUpdates)
// the page has already flushed progress; skip the close handshake and restart into the installer
ipcMain.on('update-install', () => {
  if (updateState.status !== 'ready') return
  updating = true
  autoUpdater.quitAndInstall(true, true)
})

// The manga translator needs a page's pixels; fetching here skips the browser's CORS rules.
const imageHosts = /(^|\.)(mangadex\.network|mangadex\.org|senkuro\.org|senkuro\.com)$/
ipcMain.handle('fetch-image', async (_e, url) => {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !imageHosts.test(u.hostname)) throw new Error('host not allowed')
  const res = await net.fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
})
ipcMain.on('close-ok', () => win && !win.isDestroyed() && win.destroy())

// Torrent streaming (AniLibria's own torrents): loaded on first use, pieces live in a temp folder until the app quits
let torrent = null
const tor = () => (torrent ??= require('./torrent.cjs'))
ipcMain.handle('torrent-open', async (_e, id) => {
  const t = tor()
  const info = await t.open(id)
  return { ...info, files: info.files.map((f) => ({ ...f, url: t.streamUrl(info.infoHash, f.index) })) }
})
ipcMain.handle('torrent-stats', (_e, hash, index) => tor().stats(hash, index))
ipcMain.handle('torrent-drop', (_e, hash) => tor().drop(hash))
ipcMain.handle('torrent-warm', (_e, hash, index, from, to) => tor().warm(hash, index, from, to))
ipcMain.handle('torrent-ready', (_e, hash, index, from, to) => tor().ready(hash, index, from, to))
app.on('will-quit', () => torrent?.shutdown())

// Voice module: F5-TTS on the GPU, installed apart from the app (several GB) in %USERPROFILE%\AniPlayer-voice.
// Started on the first read-aloud, not with the app, so the GPU memory stays free until then.
const VOICE_HOME = path.join(app.getPath('home'), 'AniPlayer-voice')
let voiceProc = null
ipcMain.handle('voice-start', () => {
  const py = path.join(VOICE_HOME, '.venv', 'Scripts', 'python.exe')
  if (!fs.existsSync(py) || !fs.existsSync(path.join(VOICE_HOME, 'models'))) return { installed: false }
  if (voiceProc) return { installed: true }
  const script = path.join(VOICE_HOME, 'server.py')
  try {
    // the server ships with the app and updates with it
    const src = fs.readFileSync(path.join(__dirname, 'voice-server.py'))
    if (!fs.existsSync(script) || !fs.readFileSync(script).equals(src)) fs.writeFileSync(script, src)
  } catch (e) {
    console.warn('[voice]', e)
  }
  voiceProc = spawn(py, [script], { cwd: VOICE_HOME, windowsHide: true, stdio: 'ignore', env: { ...process.env, ANIPLAYER_VOICE_HOME: VOICE_HOME, PYTHONUTF8: '1' } })
  voiceProc.on('exit', () => (voiceProc = null))
  return { installed: true }
})
app.on('will-quit', () => voiceProc?.kill())

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)))
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
    return net.fetch(pathToFileURL(file).toString())
  })
  // MangaDex answers CORS only for web origins (https://localhost and the like), not app://;
  // Senkuro sends no CORS headers at all. Page images need it too: the translator reads their pixels.
  const corsHosts = [
    'https://api.mangadex.org/*',
    'https://api.senkuro.com/*',
    'https://*.mangadex.network/*',
    'https://uploads.mangadex.org/*',
    'https://mirai.senkuro.org/*',
    'https://ranobehub.org/*',
  ]
  session.defaultSession.webRequest.onHeadersReceived({ urls: corsHosts }, (d, cb) => {
    const headers = Object.fromEntries(Object.entries(d.responseHeaders ?? {}).filter(([k]) => k.toLowerCase() !== 'access-control-allow-origin'))
    headers['Access-Control-Allow-Origin'] = ['app://aniplayer']
    cb({ responseHeaders: headers })
  })
  // MangaDex asks API clients to name themselves; a browser User-Agent gets sent to its bot check (HTTP 403)
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://api.mangadex.org/*'] }, (d, cb) => {
    d.requestHeaders['User-Agent'] = `Anyflow/${app.getVersion()} (+https://github.com/vanaedynak/AniPlayer)`
    cb({ requestHeaders: d.requestHeaders })
  })
  createWindow()
  initUpdater()
})

app.on('window-all-closed', () => app.quit())
