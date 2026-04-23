import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:4000';

let overlayWindow      = null;
let dragState          = null;
const HOTKEY           = 'CommandOrControl+Shift+H';
const LISTEN_HOTKEY    = 'CommandOrControl+Shift+X';

// ── Overlay (HUD) ────────────────────────────────────────────────────────────

const OVERLAY_WIDTH  = 380;
const OVERLAY_HEIGHT = 600;

// ── Persisted window bounds (position + size) ────────────────────────────────
// Stored in Electron's per-user app-data dir (e.g. on macOS:
// ~/Library/Application Support/<appName>/hud-window-state.json). Survives
// reinstalls of the project folder and isn't checked into git.
let _stateFilePath = null;   // resolved lazily inside whenReady — app.getPath() needs the app ready
let _saveTimer     = null;

function stateFilePath() {
  if (_stateFilePath) return _stateFilePath;
  _stateFilePath = path.join(app.getPath('userData'), 'hud-window-state.json');
  return _stateFilePath;
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf8');
    const s = JSON.parse(raw);
    if (
      Number.isFinite(s.x) && Number.isFinite(s.y) &&
      Number.isFinite(s.width) && Number.isFinite(s.height) &&
      s.width >= 200 && s.height >= 200
    ) {
      return s;
    }
  } catch {}
  return null;
}

function boundsIntersectAnyDisplay(b) {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return (
      b.x < wa.x + wa.width  && b.x + b.width  > wa.x &&
      b.y < wa.y + wa.height && b.y + b.height > wa.y
    );
  });
}

function saveWindowState() {
  if (!overlayWindow) return;
  if (overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  try {
    fs.mkdirSync(path.dirname(stateFilePath()), { recursive: true });
    fs.writeFileSync(stateFilePath(), JSON.stringify(bounds));
  } catch {}
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveWindowState, 400);
}

function defaultBoundsNearCursor() {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { workArea } = display;
  return {
    x: workArea.x + 24,
    y: workArea.y + 24,
    width:  OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
  };
}

function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.show();
    return;
  }

  // Decide initial bounds: saved state wins if it's still on a connected
  // display; otherwise fall back to a corner of the display under the cursor.
  const saved = loadWindowState();
  const initial = (saved && boundsIntersectAnyDisplay(saved))
    ? saved
    : defaultBoundsNearCursor();

  overlayWindow = new BrowserWindow({
    x:      initial.x,
    y:      initial.y,
    width:  initial.width,
    height: initial.height,
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
    // No re-positioning here — we honor the saved/default bounds set above.
    overlayWindow.show();
  });

  // Persist position + size on user changes. Both events fire rapidly during
  // drag/resize, so debounce writes (400 ms) to keep disk churn minimal.
  overlayWindow.on('move',   scheduleSave);
  overlayWindow.on('resize', scheduleSave);
  // Final write when the window disappears — catches the very last position
  // even if the debounce timer hadn't fired yet.
  overlayWindow.on('close',  saveWindowState);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    dragState = null;
  });

  overlayWindow.loadFile(path.join(__dirname, 'hud.html'), {
    query: { socketUrl: SOCKET_URL },
  });
}

function toggleOverlay() {
  if (!overlayWindow) {
    // First Cmd+Shift+H of this app run — lazily create the window at its
    // saved bounds (or default position under the cursor).
    createOverlayWindow();
    return;
  }
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    // Honor saved position — do NOT reposition near the cursor on show.
    overlayWindow.show();
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // HUD drag (mouse-down in the HUD → set startX/Y; mouse-move → delta-move)
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

  // Hotkeys
  const registered = globalShortcut.register(HOTKEY, toggleOverlay);
  if (!registered) console.warn(`Failed to register hotkey ${HOTKEY}`);

  const listenRegistered = globalShortcut.register(LISTEN_HOTKEY, () => {
    overlayWindow?.webContents.send('toggle-listen');
  });
  if (!listenRegistered) console.warn(`Failed to register listen hotkey ${LISTEN_HOTKEY}`);

  // HUD is NOT opened on startup — user presses Cmd+Shift+H to open it the
  // first time. Previous behavior (auto-open) was surprising after a restart.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
