import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:4000';

let overlayWindow = null;
let dragState = null;
const HOTKEY = 'CommandOrControl+Shift+H';
const LISTEN_HOTKEY = 'CommandOrControl+Shift+X';

function positionOverlayOnDisplayUnderCursor(win) {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { workArea } = display;

  const insetX = 24;
  const insetY = 24;
  const width = 380;
  const height = 460;

  const x = workArea.x + insetX;
  const y = workArea.y + insetY;

  win.setBounds({ x, y, width, height });
}

function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.show();
    positionOverlayOnDisplayUnderCursor(overlayWindow);
    return;
  }

  overlayWindow = new BrowserWindow({
    parent: undefined,
    width: 380,
    height: 600,
    transparent: false,
    backgroundColor: '#12121a',
    frame: false,
    hasShadow: true,
    thickFrame: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    nodeIntegration: false,
    contextIsolation: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  overlayWindow.setContentProtection(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWindow.on('ready-to-show', () => {
    positionOverlayOnDisplayUnderCursor(overlayWindow);
    overlayWindow.show();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    dragState = null;
  });

  ipcMain.on('hud-drag-start', (_e, screenX, screenY) => {
    if (overlayWindow) {
      const [x, y] = overlayWindow.getPosition();
      dragState = {
        startScreenX: screenX,
        startScreenY: screenY,
        startX: x,
        startY: y,
      };
    }
  });

  ipcMain.on('hud-drag-move', (_e, screenX, screenY) => {
    if (dragState && overlayWindow) {
      const deltaX = screenX - dragState.startScreenX;
      const deltaY = screenY - dragState.startScreenY;
      overlayWindow.setPosition(
        Math.round(dragState.startX + deltaX),
        Math.round(dragState.startY + deltaY),
      );
    }
  });

  ipcMain.on('hud-drag-end', () => {
    dragState = null;
  });

  ipcMain.on('hud-set-opacity', (_e, value) => {
    if (!overlayWindow) return;
    // value: 0 = fully opaque, 100 = fully transparent
    // clamp to 0.1 minimum so the window stays visible/clickable
    const opacity = Math.max(0.1, 1 - Math.max(0, Math.min(100, value)) / 100);
    overlayWindow.setOpacity(opacity);
  });

  overlayWindow.loadFile(path.join(__dirname, 'hud.html'), {
    query: { socketUrl: SOCKET_URL },
  });
}

function toggleOverlay() {
  if (!overlayWindow) {
    createOverlayWindow();
    return;
  }

  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    overlayWindow.show();
    positionOverlayOnDisplayUnderCursor(overlayWindow);
  }
}

app.whenReady().then(() => {
  const registered = globalShortcut.register(HOTKEY, toggleOverlay);
  if (!registered) {
    console.warn(`Failed to register hotkey ${HOTKEY}`);
  }

  const listenRegistered = globalShortcut.register(LISTEN_HOTKEY, () => {
    overlayWindow?.webContents.send('toggle-listen');
  });
  if (!listenRegistered) {
    console.warn(`Failed to register listen hotkey ${LISTEN_HOTKEY}`);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
