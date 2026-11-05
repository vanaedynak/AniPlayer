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
    save(hash) {
      return ipcRenderer.invoke('torrent-save', hash)
    },
    saves() {
      return ipcRenderer.invoke('torrent-saves')
    },
    pauseSave(hash, paused) {
      return ipcRenderer.invoke('torrent-save-pause', hash, paused)
    },
    removeSave(hash) {
      return ipcRenderer.invoke('torrent-save-remove', hash)
    },
    openSaved(hash) {
      return ipcRenderer.invoke('torrent-open-saved', hash)
    },
    showSave(hash) {
      return ipcRenderer.invoke('torrent-save-show', hash)
    },
  },
  discord: {
    setActivity(id, activity) {
      return ipcRenderer.invoke('discord-activity', id, activity)
    },
  },
  /** anyflow:// links that opened or reached the app; cb gets each one once */
  onDeepLink(cb) {
    const take = () => ipcRenderer.invoke('deep-link-take').then((url) => url && cb(url))
    ipcRenderer.on('deep-link', take)
    void take()
    return () => ipcRenderer.removeListener('deep-link', take)
  },
  fetchText(url) {
    return ipcRenderer.invoke('fetch-text', url)
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
