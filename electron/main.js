import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:4000';

let overlayWindow      = null;
let notifWindow        = null;
let dragState          = null;
const HOTKEY           = 'CommandOrControl+Shift+H';
const LISTEN_HOTKEY    = 'CommandOrControl+Shift+X';

// ── Overlay (HUD) ────────────────────────────────────────────────────────────

function positionOverlayOnDisplayUnderCursor(win) {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { workArea } = display;

  const insetX = 24;
  const insetY = 24;
  const width  = 380;
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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
    // Close notification window alongside the HUD
    if (notifWindow && !notifWindow.isDestroyed()) {
      notifWindow.close();
    }
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
    if (notifWindow && !notifWindow.isDestroyed()) notifWindow.hide();
  } else {
    overlayWindow.show();
    positionOverlayOnDisplayUnderCursor(overlayWindow);
  }
}

// ── Notification window (interviewer enrollment popup) ────────────────────────

const NOTIF_WIDTH  = 380;
const NOTIF_HEIGHT = 112;

function getNotifPosition() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    // Fallback: top-right of primary display
    const { workArea } = screen.getPrimaryDisplay();
    return {
      x: workArea.x + workArea.width - NOTIF_WIDTH - 24,
      y: workArea.y + 24,
    };
  }
  const [hudX, hudY] = overlayWindow.getPosition();
  const notifY = hudY - NOTIF_HEIGHT - 8;   // just above the HUD
  const { workArea } = screen.getDisplayNearestPoint({ x: hudX, y: hudY });
  return {
    x: hudX,
    y: Math.max(workArea.y, notifY),         // don't go off-screen
  };
}

function ensureNotifWindow() {
  if (notifWindow && !notifWindow.isDestroyed()) return;

  notifWindow = new BrowserWindow({
    width:  NOTIF_WIDTH,
    height: NOTIF_HEIGHT,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: true,
    thickFrame: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'notification-preload.js'),
    },
  });

  notifWindow.setContentProtection(true);
  notifWindow.setAlwaysOnTop(true, 'screen-saver');
  notifWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  notifWindow.on('closed', () => { notifWindow = null; });

  notifWindow.loadFile(path.join(__dirname, 'interviewer-notification.html'), {
    query: { socketUrl: SOCKET_URL },
  });
}

// ── IPC ──────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // HUD drag
  ipcMain.on('hud-drag-start', (_e, screenX, screenY) => {
    if (overlayWindow) {
      const [x, y] = overlayWindow.getPosition();
      dragState = { startScreenX: screenX, startScreenY: screenY, startX: x, startY: y };
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

  ipcMain.on('hud-drag-end', () => { dragState = null; });

  ipcMain.on('hud-set-opacity', (_e, value) => {
    if (!overlayWindow) return;
    const opacity = Math.max(0.1, 1 - Math.max(0, Math.min(100, value)) / 100);
    overlayWindow.setOpacity(opacity);
  });

  // Notification window show/hide (called from notification-preload bridge)
  ipcMain.on('notif-show', () => {
    ensureNotifWindow();
    const { x, y } = getNotifPosition();
    notifWindow.setBounds({ x, y, width: NOTIF_WIDTH, height: NOTIF_HEIGHT });
    notifWindow.show();
    notifWindow.focus();
  });

  ipcMain.on('notif-hide', () => {
    if (notifWindow && !notifWindow.isDestroyed()) notifWindow.hide();
  });

  // Hotkeys
  const registered = globalShortcut.register(HOTKEY, toggleOverlay);
  if (!registered) console.warn(`Failed to register hotkey ${HOTKEY}`);

  const listenRegistered = globalShortcut.register(LISTEN_HOTKEY, () => {
    overlayWindow?.webContents.send('toggle-listen');
  });
  if (!listenRegistered) console.warn(`Failed to register listen hotkey ${LISTEN_HOTKEY}`);

  // Pre-create the notification window so it's ready when first popup fires
  ensureNotifWindow();
  createOverlayWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
