/**
 * Window — BrowserWindow creation, positioning, and visibility management.
 */

import { BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';
import { loadOverlayConfig, saveOverlayConfig, setHermesModel } from './config';

let mainWindow: BrowserWindow | null = null;
let isVisible = false;
let hideTimeout: NodeJS.Timeout | null = null;
let isQuitting = false;
let isDragging = false;
let isContentResize = false;
let contentResizeTimeout: NodeJS.Timeout | null = null;

const WIDTH = 430;
const DEFAULT_HEIGHT = 90;
const MAX_HEIGHT = 420;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getIsVisible(): boolean {
  return isVisible;
}

export function resizeWindowToContent(requestedHeight: number) {
  if (!mainWindow || mainWindow.isDestroyed() || !Number.isFinite(requestedHeight)) return;

  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const height = Math.max(72, Math.min(
    Math.round(requestedHeight),
    MAX_HEIGHT,
    display.workArea.height - 32,
  ));
  if (height !== bounds.height) {
    isContentResize = true;
    mainWindow.setSize(bounds.width, height, false);
    if (contentResizeTimeout) clearTimeout(contentResizeTimeout);
    contentResizeTimeout = setTimeout(() => {
      isContentResize = false;
      contentResizeTimeout = null;
    }, 250);
  }
}

export function setOverlayHorizontalPosition(position: 'left' | 'right') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  const margin = 16;
  const x = position === 'left'
    ? workArea.x + margin
    : workArea.x + workArea.width - bounds.width - margin;
  const next = clampToScreen(x, bounds.y, bounds.width, bounds.height);
  mainWindow.setPosition(next.x, next.y, false);
  saveOverlayConfig({ bounds: mainWindow.getBounds() });
}

export function setIsQuitting(value: boolean) {
  isQuitting = value;
}

export function clampToScreen(x: number, y: number, width: number, height: number) {
  const displays = screen.getAllDisplays();
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  let bestDisplay = displays[0];
  let bestDist = Infinity;
  for (const d of displays) {
    const dx = (d.bounds.x + d.bounds.width / 2) - centerX;
    const dy = (d.bounds.y + d.bounds.height / 2) - centerY;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestDisplay = d;
    }
  }
  const wa = bestDisplay.workArea;
  const margin = 16;
  // Keep window fully within work area
  const minX = wa.x + margin;
  const maxX = wa.x + wa.width - width - margin;
  const minY = wa.y + margin;
  const maxY = wa.y + wa.height - height - margin;
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, x))),
    y: Math.round(Math.max(minY, Math.min(maxY, y))),
  };
}

export function createWindow(showInitially = true) {
  const config = loadOverlayConfig();
  const savedBounds = config.bounds;

  // Validate saved bounds — if invalid (off-screen), discard and use defaults
  let useSavedBounds = false;
  if (savedBounds) {
    const { workArea } = screen.getPrimaryDisplay();
    const margin = 16;
    const minX = workArea.x + margin;
    const maxX = workArea.x + workArea.width - WIDTH - margin;
    const minY = workArea.y + margin;
    const maxY = workArea.y + workArea.height - DEFAULT_HEIGHT - margin;
    const xInRange = savedBounds.x >= minX && savedBounds.x <= maxX;
    const yInRange = savedBounds.y >= minY && savedBounds.y <= maxY;
    useSavedBounds = xInRange && yInRange;
  }

  mainWindow = new BrowserWindow({
    width: WIDTH,
    // Keep the initial native window compact even when older saved bounds
    // contain the previous full-panel height. Content resizing takes over
    // after the renderer's first layout pass.
    height: DEFAULT_HEIGHT,
    x: useSavedBounds ? savedBounds.x : undefined,
    y: useSavedBounds ? savedBounds.y : undefined,
    minWidth: 390,
    maxWidth: WIDTH,
    minHeight: 72,
    maxHeight: MAX_HEIGHT,
    frame: false,
    icon: path.join(__dirname, '../../assets/icon.png'),
    alwaysOnTop: savedBounds?.alwaysOnTop ?? true,
    transparent: true,
    hasShadow: false,
    thickFrame: false,
    skipTaskbar: true,
    show: false,
    resizable: false,
    title: 'Hermes',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Avoid flashing a blank window on launch, then show it once the first frame is ready.
  // Ordinary Start Menu launches should make it clear that the app is running.
  mainWindow.once('ready-to-show', () => {
    if (showInitially) showWindow();
  });

  if (!useSavedBounds) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { workArea } = display;
    const width = Math.min(WIDTH, workArea.width - 40);
    const height = Math.min(DEFAULT_HEIGHT, workArea.height - 96);
    const x = workArea.x + Math.round((workArea.width - width) / 2);
    const y = workArea.y + Math.max(22, Math.round(workArea.height * 0.05));
    mainWindow.setBounds({ x, y, width, height });
  }

  mainWindow.setTitle('Hermes');

  // Prevent destroy on close — hide instead
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.webContents.send('visibility-change', false);
      isVisible = false;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  
  // Clamp position when window moves (native drag via -webkit-app-region: drag)
  mainWindow.on('moved', () => {
    if (mainWindow && !isDragging) {
      const bounds = mainWindow.getBounds();
      const clamped = clampToScreen(bounds.x, bounds.y, bounds.width, bounds.height);
      if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
        mainWindow.setPosition(clamped.x, clamped.y);
      }
      saveOverlayConfig({ bounds: mainWindow.getBounds() });
    }
  });
  mainWindow.on('resized', () => {
    if (mainWindow && !isDragging) {
      const bounds = mainWindow.getBounds();
      const clamped = clampToScreen(bounds.x, bounds.y, bounds.width, bounds.height);
      if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
        mainWindow.setPosition(clamped.x, clamped.y);
      }
      if (!isContentResize) saveOverlayConfig({ bounds: mainWindow.getBounds() });
    }
  });

  // Persistent safety net: clamp every 100ms to catch DWM snaps
  const safetyInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || isDragging) return;
    const bounds = mainWindow.getBounds();
    const clamped = clampToScreen(bounds.x, bounds.y, bounds.width, bounds.height);
    if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
      console.log(`[Safety] Clamping: (${bounds.x},${bounds.y}) -> (${clamped.x},${clamped.y})`);
      mainWindow.setPosition(clamped.x, clamped.y);
    }
  }, 100);

  mainWindow.on('closed', () => {
    clearInterval(safetyInterval);
    mainWindow = null;
  });

  // Native drag region is handled by CSS (-webkit-app-region: drag on overlay-drag-handle)
  // Main process only needs to clamp position on 'moved' event
  // No IPC drag handlers needed!

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

export function toggleVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (hideTimeout) clearTimeout(hideTimeout);

  if (isVisible) {
    isVisible = false;
    mainWindow.webContents.send('visibility-change', false);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  } else {
    showWindow();
  }
}

export function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (hideTimeout) clearTimeout(hideTimeout);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  isVisible = true;
  mainWindow.webContents.send('visibility-change', true);
  mainWindow.focus();
  mainWindow.webContents.send('focus-input');
}
