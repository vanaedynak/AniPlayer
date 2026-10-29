const { contextBridge, ipcRenderer, webFrame } = require('electron')

contextBridge.exposeInMainWorld('aniplayer', {
  isElectron: true,
  fetchText(url) {
    return ipcRenderer.invoke('fetch-text', url)
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
