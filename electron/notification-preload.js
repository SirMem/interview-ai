const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notifAPI', {
  show: () => ipcRenderer.send('notif-show'),
  hide: () => ipcRenderer.send('notif-hide'),
});
