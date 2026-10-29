const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aniplayer', {
  isElectron: true,
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
