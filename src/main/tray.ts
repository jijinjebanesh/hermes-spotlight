/**
 * Tray — System tray icon and context menu.
 */

import { Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { toggleVisibility, getMainWindow, getIsVisible } from './window';

let tray: Tray | null = null;

export function createTray(onQuit: () => void) {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip('Hermes Overlay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show/Hide', click: () => toggleVisibility() },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]));
  tray.on('click', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (getIsVisible()) {
        win.focus();
      } else {
        toggleVisibility();
      }
    }
  });
}
