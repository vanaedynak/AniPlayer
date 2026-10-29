// Electron shell for Windows. Serves the built app from app://aniplayer so the
// page has a proper secure origin (IndexedDB, Firebase Auth and CORS all behave).
const { app, BrowserWindow, protocol, net, ipcMain, shell, nativeTheme } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const DEV_URL = process.env.VITE_DEV_URL
const DIST = path.join(__dirname, '..', 'dist')
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

if (!app.requestSingleInstanceLock()) app.quit()

nativeTheme.themeSource = 'dark'
let win = null

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
    if (closing) return
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
  createWindow()
})

app.on('window-all-closed', () => app.quit())
