// Electron shell for Windows. Serves the built app from app://aniplayer so the
// page has a proper secure origin (IndexedDB, Firebase Auth and CORS all behave).
const { app, BrowserWindow, protocol, net, ipcMain, shell, nativeTheme, Menu, session, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { autoUpdater } = require('electron-updater')
// names, data folder, link scheme and update address: this copy of the project (the main app or the lab)
const flavor = require('../flavor.json')

const DEV_URL = process.env.VITE_DEV_URL
const DIST = path.join(__dirname, '..', 'dist')
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

// the app was called AniPlayer before: its data folder keeps that name, so a renamed app finds
// the history, downloads and logins where they always were
app.setPath('userData', path.join(app.getPath('appData'), flavor.dataFolder))

if (!app.requestSingleInstanceLock()) app.quit()

// anyflow://join/CODE: an invite to a watch-together room (the Discord button, a link from a friend).
// The link is kept until the page takes it, so one that starts the app is not lost while it loads.
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(flavor.scheme, process.execPath, [path.resolve(process.argv[1])])
else app.setAsDefaultProtocolClient(flavor.scheme)
let pendingLink = process.argv.find((a) => a.startsWith(`${flavor.scheme}://`)) ?? null
function deliverLink(url) {
  pendingLink = url
  if (win && !win.isDestroyed()) win.webContents.send('deep-link')
}
ipcMain.handle('deep-link-take', () => {
  const url = pendingLink
  pendingLink = null
  return url
})

// Discord status, loaded on first use
let discord = null
ipcMain.handle('discord-activity', (_e, id, activity) => (discord ??= require('./discord.cjs')).setActivity(String(id ?? ''), activity ?? null))
app.on('will-quit', () => discord?.shutdown())

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
      // video.audioTracks: a BDRip mkv carries several dubs, the player lets you pick one
      enableBlinkFeatures: 'AudioVideoTracks',
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

// electron-updater's errors carry whole HTTP headers and a stack: the page gets one short line instead
function updateError(e) {
  const text = String(e?.message ?? e)
  console.warn('[updates]', text)
  if (/HttpError: 404|Cannot find channel/i.test(text)) return `на GitHub нет файла обновления (github.com/${flavor.repo} закрыт или сборка ещё идёт)`
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(text)) return 'нет связи с GitHub'
  const first = text.split('\n')[0]
  return first.length > 160 ? first.slice(0, 160) + '…' : first
}

function checkForUpdates() {
  if (!app.isPackaged) return setUpdate({ status: 'error', message: 'Обновления работают только в установленной версии' })
  if (updateState.status === 'downloading' || updateState.status === 'ready') return
  autoUpdater.checkForUpdates().catch((e) => setUpdate({ status: 'error', message: updateError(e) }))
}

function initUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => setUpdate({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'latest' }))
  autoUpdater.on('update-available', (i) => setUpdate({ status: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => setUpdate({ ...updateState, status: 'downloading', percent: p.percent }))
  autoUpdater.on('update-downloaded', (i) => setUpdate({ status: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => setUpdate({ status: 'error', message: updateError(e) }))
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
// Filler marks come from MyAnimeList's episode pages when its API mirror (Jikan) can't be reached
ipcMain.handle('fetch-text', async (_e, url) => {
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.hostname !== 'myanimelist.net' || !/^\/anime\/\d+\/[^/]*\/episode$/.test(u.pathname)) throw new Error('url not allowed')
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
})
ipcMain.on('close-ok', () => win && !win.isDestroyed() && win.destroy())

// Torrent streaming (AniLibria's own torrents): loaded on first use, pieces live in a temp folder until the app quits
let torrent = null
const tor = () => (torrent ??= require('./torrent.cjs'))
ipcMain.handle('torrent-open', async (_e, id) => tor().withUrls(await tor().open(id)))
// any torrent the user brings: a pasted magnet link or a picked .torrent file
ipcMain.handle('torrent-open-magnet', async (_e, uri) => tor().withUrls(await tor().openMagnet(uri)))
ipcMain.handle('torrent-open-file', async (_e, bytes) => tor().withUrls(await tor().openFile(bytes)))
ipcMain.handle('torrent-stats', (_e, hash, index) => tor().stats(hash, index))
ipcMain.handle('torrent-drop', (_e, hash) => tor().drop(hash))
ipcMain.handle('torrent-warm', (_e, hash, index, from, to) => tor().warm(hash, index, from, to))
ipcMain.handle('torrent-ready', (_e, hash, index, from, to) => tor().ready(hash, index, from, to))
// a whole torrent saved into a folder the user picks; it carries on after a restart
const validHash = (h) => typeof h === 'string' && /^[0-9a-f]{40}$/.test(h)
ipcMain.handle('torrent-save', async (_e, hash) => {
  if (!validHash(hash)) return null
  const r = await dialog.showOpenDialog(win, {
    title: 'Куда сохранить торрент',
    defaultPath: app.getPath('videos'),
    buttonLabel: 'Сохранить сюда',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (r.canceled || !r.filePaths[0]) return null
  await tor().save(hash, r.filePaths[0])
  return r.filePaths[0]
})
ipcMain.handle('torrent-saves', () => tor().listSaves())
ipcMain.handle('torrent-save-pause', (_e, hash, paused) => validHash(hash) && tor().pauseSave(hash, paused))
ipcMain.handle('torrent-save-remove', (_e, hash) => validHash(hash) && tor().removeSave(hash))
ipcMain.handle('torrent-open-saved', async (_e, hash) => tor().withUrls(await tor().openSaved(hash)))
ipcMain.handle('torrent-save-show', (_e, hash) => {
  const p = validHash(hash) && tor().savePath(hash)
  if (p) void shell.openPath(p)
})
// unfinished saves go on a few seconds after start, once the window is up
app.whenReady().then(() => {
  if (fs.existsSync(path.join(app.getPath('userData'), 'torrent-saves.json')))
    setTimeout(() => tor().resumeSaves().catch((e) => console.warn('[torrent] resume', e?.message ?? e)), 5000)
})
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

app.on('second-instance', (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${flavor.scheme}://`))
  if (link) deliverLink(link)
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
  // MangaDex asks API clients to name themselves; a browser User-Agent gets sent to its bot check (HTTP 403).
  // Its pictures (covers, and pages on its own and MD@Home servers) are behind the same check now
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://api.mangadex.org/*', 'https://uploads.mangadex.org/*', 'https://*.mangadex.network/*'] }, (d, cb) => {
    d.requestHeaders['User-Agent'] = `Anyflow/${app.getVersion()} (+https://github.com/${flavor.repo})`
    cb({ requestHeaders: d.requestHeaders })
  })
  createWindow()
  initUpdater()
})

app.on('window-all-closed', () => app.quit())
