const { contextBridge, ipcRenderer, webFrame } = require('electron')

contextBridge.exposeInMainWorld('aniplayer', {
  isElectron: true,
  version() {
    return ipcRenderer.invoke('app-version')
  },
  updates: {
    get() {
      return ipcRenderer.invoke('update-state')
    },
    check() {
      ipcRenderer.send('update-check')
    },
    install() {
      ipcRenderer.send('update-install')
    },
    onChange(cb) {
      const fn = (_e, s) => cb(s)
      ipcRenderer.on('update-state', fn)
      return () => ipcRenderer.removeListener('update-state', fn)
    },
  },
  voice: {
    start() {
      return ipcRenderer.invoke('voice-start')
    },
  },
  torrent: {
    open(id) {
      return ipcRenderer.invoke('torrent-open', id)
    },
    openMagnet(uri) {
      return ipcRenderer.invoke('torrent-open-magnet', uri)
    },
    openFile(bytes) {
      return ipcRenderer.invoke('torrent-open-file', bytes)
    },
    stats(hash, index) {
      return ipcRenderer.invoke('torrent-stats', hash, index)
    },
    drop(hash) {
      return ipcRenderer.invoke('torrent-drop', hash)
    },
    warm(hash, index, from, to) {
      return ipcRenderer.invoke('torrent-warm', hash, index, from, to)
    },
    ready(hash, index, from, to) {
      return ipcRenderer.invoke('torrent-ready', hash, index, from, to)
    },
  },
  fetchImage(url) {
    return ipcRenderer.invoke('fetch-image', url)
  },
  setZoom(factor) {
    webFrame.setZoomFactor(factor)
  },
  onBeforeClose(cb) {
    ipcRenderer.on('before-close', async () => {
      try {
        await cb()
      } finally {
        ipcRenderer.send('close-ok')
      }
    })
  },
})
