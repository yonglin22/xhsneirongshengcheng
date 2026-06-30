const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  onDevices: (cb) => ipcRenderer.on('devices', (e, list) => cb(list)),
  setToken: (serial, token) => ipcRenderer.invoke('setToken', { serial, token }),
  openScrcpy: (serial) => ipcRenderer.invoke('openScrcpy', { serial }),
  getConfig: () => ipcRenderer.invoke('getConfig'),
  setServer: (serverBase) => ipcRenderer.invoke('setServer', { serverBase }),
});
