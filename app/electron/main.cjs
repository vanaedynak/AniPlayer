// Electron shell for Windows. Serves the built app from app://aniplayer so the
// page has a proper secure origin (IndexedDB, Firebase Auth and CORS all behave).
const { app, BrowserWindow, protocol, net, ipcMain, shell, nativeTheme, Menu, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { autoUpdater } = require('electron-updater')

const DEV_URL = process.env.VITE_DEV_URL
const DIST = path.join(__dirname, '..', 'dist')
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

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
    backgroundColor: '#09090d',
    title: 'AniPlayer',
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

ipcMain.on('close-ok', () => win && !win.isDestroyed() && win.destroy())

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
  // MangaDex answers CORS only for web origins (https://localhost and the like), not app://
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://api.mangadex.org/*'] }, (d, cb) => {
    const headers = Object.fromEntries(Object.entries(d.responseHeaders ?? {}).filter(([k]) => k.toLowerCase() !== 'access-control-allow-origin'))
    headers['Access-Control-Allow-Origin'] = ['app://aniplayer']
    cb({ responseHeaders: headers })
  })
  createWindow()
  initUpdater()
})

app.on('window-all-closed', () => app.quit())
