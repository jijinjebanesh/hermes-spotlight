/**
 * Main Process Orchestrator — Hermes Overlay
 *
 * This is the slim entry point that composes all modules:
 * - config:        Overlay config persistence
 * - window:        BrowserWindow lifecycle & visibility
 * - tray:          System tray icon
 * - hotkey-server: HTTP toggle server for AHK
 * - ipc-handlers:  All IPC handler registrations
 * - clap-detector: Python clap detection subprocess
 * - hermes-cli:    Hermes CLI spawning & streaming
 *
 * Previously 1305 lines — now a clean composition.
 */

import { app, BrowserWindow, globalShortcut, net, protocol, screen } from 'electron';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { loadOverlayConfig, saveOverlayConfig } from './config';
import { createWindow, toggleVisibility, showWindow, setIsQuitting, getMainWindow, clampToScreen } from './window';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';
import { stopWhisperDaemon } from './whisper-daemon';
import { killActiveChild } from './hermes-cli';
import { registerQuickActionsHotkey, unregisterQuickActionsHotkey } from './quick-actions';

function registerLocalFileProtocol() {
  try {
    protocol.handle('local-file', async (request) => {
      const url = new URL(request.url);
      const filePath = url.searchParams.get('path');

      if (!filePath) {
        return new Response('Missing file path', { status: 400 });
      }

      if (!path.isAbsolute(filePath)) {
        return new Response('Path must be absolute', { status: 400 });
      }

      try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
          return new Response('Not a file', { status: 400 });
        }
      } catch (e) {
        return new Response('File not found', { status: 404 });
      }

      return net.fetch(pathToFileURL(filePath).toString());
    });
  } catch (error) {
    console.error('Failed to register local-file protocol:', error);
  }
}

/* ═══════════════════════════════════════════════
   SINGLE INSTANCE LOCK
   ═══════════════════════════════════════════════ */

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      showWindow();
    }
  });

  app.whenReady().then(() => {
    registerLocalFileProtocol();
    createWindow(!process.argv.includes('--hidden'));
    createTray(() => { setIsQuitting(true); app.quit(); });
    registerIpcHandlers();

    // Register global hotkey for overlay toggle
    const config = loadOverlayConfig();
    const triggerHotkey = config.triggerHotkey || 'Control+Space';
    try {
      if (!globalShortcut.register(triggerHotkey, toggleVisibility)) {
        throw new Error(`Shortcut is already in use: ${triggerHotkey}`);
      }
      console.log('✓ Registered hotkey:', triggerHotkey);
    } catch (e) {
      console.error('Failed to register hotkey:', e);
      if (triggerHotkey !== 'Control+Alt+Space' && globalShortcut.register('Control+Alt+Space', toggleVisibility)) {
        saveOverlayConfig({ triggerHotkey: 'Control+Alt+Space' });
        console.log('✓ Registered fallback hotkey: Control+Alt+Space');
      }
    }

    // Register Quick Actions hotkey (Ctrl+Shift+A) for floating toolbar
    registerQuickActionsHotkey();

    // Register Reset Position hotkey (Ctrl+Shift+R)
    try {
      globalShortcut.register('Control+Shift+R', () => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        const { workArea } = screen.getPrimaryDisplay();
        const newWidth = Math.min(430, workArea.width - 40);
        const newHeight = Math.min(90, workArea.height - 40);
        const x = workArea.x + Math.round((workArea.width - newWidth) / 2);
        const y = workArea.y + Math.max(22, Math.round(workArea.height * 0.05));

        // Hide → resize → show → enforce position
        win.hide();
        win.setResizable(true);
        win.setSize(newWidth, newHeight, false);
        win.setResizable(false);
        win.show();

        // Enforce position multiple times
        const enforce = () => {
          const b = win.getBounds();
          if (b.x !== x || b.y !== y) {
            win.setPosition(x, y, false);
          }
        };

        enforce();
        setTimeout(enforce, 30);
        setTimeout(enforce, 100);
        setTimeout(enforce, 300);
        setTimeout(() => {
          enforce();
          saveOverlayConfig({ bounds: win.getBounds() });
        }, 500);
      });
      console.log('✓ Registered Reset Position hotkey: Ctrl+Shift+R');
    } catch (e) {
      console.error('Failed to register Reset Position hotkey:', e);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

/* ═══════════════════════════════════════════════
   APP LIFECYCLE
   ═══════════════════════════════════════════════ */

app.on('before-quit', () => {
  setIsQuitting(true);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  unregisterQuickActionsHotkey();
  stopWhisperDaemon();
  killActiveChild();
});
