/**
 * ActivationManager — Coordinates wake word and double-clap activation.
 *
 * In the renderer process, this listens to IPC events from the main process
 * (which spawns the Python clap_detector.py and wake_detector.py subprocesses).
 *
 * Activation sources:
 * 1. Double-clap: Python subprocess detects double-clap → main process
 *    sends 'enter-echo-mode' IPC → ActivationManager emits ActivationEvent
 *
 * 2. Wake word (native): Python subprocess with faster-whisper detects
 *    the configured phrase → main process sends 'enter-echo-mode' IPC
 *
 * 3. Wake word (web): Renderer handles via Web Speech API directly
 *    (optional — handled separately, not through this manager)
 *
 * 4. Hotkey / Push-to-talk: Global shortcut handled by main process
 *    → sends IPC → ActivationManager
 *
 * 5. Manual: User clicks a button → ActivationManager.emit('manual')
 *
 * Features:
 * - Configurable cooldown (prevents rapid re-activation)
 * - False-positive filtering (ignores events within cooldown window)
 * - Health monitoring for Python subprocess detectors
 */

import { EventBus } from './EventBus';
import { ActivationEvent } from './types';

const DEFAULT_COOLDOWN_MS = 2000; // 2 seconds between activations

export interface ActivationConfig {
  /** Minimum time between activation events */
  cooldownMs?: number;
}

export class ActivationManager {
  private bus: EventBus;
  private config: Required<ActivationConfig>;
  private lastActivationTime = 0;
  private ipcSetup = false;

  constructor(bus: EventBus, config?: ActivationConfig) {
    this.bus = bus;
    this.config = {
      cooldownMs: config?.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    };
  }

  /**
   * Start listening for activation events from IPC + hotkeys.
   */
  start(): void {
    if (this.ipcSetup) return;
    this.ipcSetup = true;

    // Listen for 'enter-echo-mode' IPC from main process
    // (triggered by clap detector, wake word, or hotkey)
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.onEnterEchoMode) {
      electronAPI.onEnterEchoMode(() => {
        this.emitActivation('wake_word', 'ipc: enter-echo-mode');
      });
    }

    // Listen for push-to-talk IPC
    if (electronAPI?.onPushToTalkStart) {
      electronAPI.onPushToTalkStart(() => {
        this.emitActivation('push_to_talk', 'Ctrl+Space');
      });
    }

    // Health: subscribe to clap detector status (if available)
    // The main process sends status updates via IPC
    // (Future enhancement: add IPC channel for detector health)
  }

  /**
   * Manually trigger an activation (e.g., from a UI button click).
   */
  emitActivation(source: ActivationEvent['source'], detail?: string): void {
    const now = Date.now();
    if (now - this.lastActivationTime < this.config.cooldownMs) {
      console.log(
        `[Activation] Ignoring ${source} — within cooldown (${now - this.lastActivationTime}ms < ${this.config.cooldownMs}ms)`
      );
      return;
    }

    this.lastActivationTime = now;

    this.bus.emit({
      type: 'activation',
      source,
      detail,
      timestamp: now,
    });
  }

  /**
   * Set the cooldown duration.
   */
  setCooldown(ms: number): void {
    this.config.cooldownMs = ms;
  }

  destroy(): void {
    this.ipcSetup = false;
  }
}
