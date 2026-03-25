const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hudAPI', {
  startDrag: (screenX, screenY) =>
    ipcRenderer.send('hud-drag-start', screenX, screenY),
  dragMove: (screenX, screenY) =>
    ipcRenderer.send('hud-drag-move', screenX, screenY),
  endDrag: () => ipcRenderer.send('hud-drag-end'),
});
