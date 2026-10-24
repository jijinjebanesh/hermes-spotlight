/**
 * useElectronAPI — Type-safe access to the Electron preload bridge.
 * 
 * Returns the electronAPI or null if not available (e.g., in browser dev).
 * All IPC calls are fully typed via the ElectronAPI interface.
 */

import type { ElectronAPI } from '../types/electron-api.d';

let cachedApi: ElectronAPI | null = null;
let checked = false;

export function useElectronAPI(): ElectronAPI | null {
  if (!checked) {
    cachedApi = (typeof window !== 'undefined' && window.electronAPI) || null;
    checked = true;
  }
  return cachedApi;
}

/**
 * getElectronAPI — Non-hook version for use in stores and callbacks.
 * Returns the API or null.
 */
export function getElectronAPI(): ElectronAPI | null {
  return (typeof window !== 'undefined' && window.electronAPI) || null;
}
