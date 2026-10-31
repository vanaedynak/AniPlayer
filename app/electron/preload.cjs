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
