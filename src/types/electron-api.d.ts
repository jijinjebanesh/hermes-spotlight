/**
 * Typed ElectronAPI global declaration.
 * Re-exports the interface from preload for use in renderer code.
 * Eliminates `(window as any).electronAPI as any` pattern.
 */

import type { ElectronAPI } from '../preload/preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export type { ElectronAPI };
export type { ParsedSegment, InventoryPayload } from '../preload/preload';
