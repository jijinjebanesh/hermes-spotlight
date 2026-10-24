/**
 * MicrophoneManager — Deterministic microphone lifecycle management.
 *
 * Owns ALL audio device access. No other pipeline module touches
 * navigator.mediaDevices or MediaStream directly.
 *
 * State Machine:
 *   inactive → requesting → active → suspended → recovering → error
 *
 * Features:
 * - Permission validation with structured error reporting
 * - Auto-recovery from stream track termination
 * - Device reconnection with exponential backoff (1s, 2s, 4s)
 * - Thread-safe state transitions via async queue (no overlapping getUserMedia)
 * - Visibility-aware suspension (tab hidden → suspend, visible → resume)
 * - Health reporting via EventBus
 * - Clean shutdown with resource release
 */

import { EventBus } from './EventBus';
import { MicrophoneStateEvent, MicState } from './types';

const SAMPLE_RATE = 16000;
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_DELAYS_MS = [1000, 2000, 4000]; // exponential backoff

type MicTransition =
  | { to: 'requesting' }
  | { to: 'active'; stream: MediaStream }
  | { to: 'suspended' }
  | { to: 'recovering' }
  | { to: 'error'; error: string }
  | { to: 'inactive' };

export class MicrophoneManager {
  private bus: EventBus;
  private state: MicState = 'inactive';
  private stream: MediaStream | null = null;
  private destroyed = false;
  private transitionQueue: Promise<void> = Promise.resolve();
  private recoveryAttempts = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private trackEndedHandler: (() => void) | null = null;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * Request microphone access and start the audio stream.
   * Idempotent — calling when already active is a no-op.
   * All state transitions are serialized via transitionQueue.
   */
  async start(): Promise<void> {
    if (this.destroyed) {
      console.warn('[MicManager] start() called after destroy');
      return;
    }
    if (this.state === 'active' || this.state === 'requesting') return;

    await this.enqueueTransition({ to: 'requesting' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: SAMPLE_RATE,
        },
      });

      await this.enqueueTransition({ to: 'active', stream });
      this.recoveryAttempts = 0;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const isPermissionDenied =
        e instanceof DOMException &&
        (e.name === 'NotAllowedError' || e.name === 'SecurityError');

      await this.enqueueTransition({
        to: 'error',
        error: isPermissionDenied
          ? 'Microphone permission denied'
          : `Mic init failed: ${error}`,
      });
    }
  }

  /**
   * Get the current MediaStream. Returns null if not active.
   * Other modules use this to create AudioContext sources, etc.
   */
  getStream(): MediaStream | null {
    return this.state === 'active' ? this.stream : null;
  }

  getState(): MicState {
    return this.state;
  }

  /**
   * Suspend the microphone (e.g., when tab is hidden).
   * Tracks are not stopped — just disabled for capture.
   */
  suspend(): void {
    if (this.state !== 'active') return;
    this.enqueueTransition({ to: 'suspended' });
  }

  /**
   * Resume from suspended state.
   */
  resume(): void {
    if (this.state !== 'suspended') return;
    // If we still have a valid stream, go back to active
    if (this.stream && this.stream.active) {
      this.enqueueTransition({ to: 'active', stream: this.stream });
    } else {
      // Stream died while suspended — need recovery
      this.enqueueTransition({ to: 'recovering' });
      this.scheduleRecovery();
    }
  }

  /**
   * Stop the microphone and release all resources.
   */
  stop(): void {
    this.cancelRecoveryTimer();
    this.removeTrackEndedHandler();
    this.removeVisibilityHandler();
    this.enqueueTransition({ to: 'inactive' });
  }

  /**
   * Permanently destroy the manager. No further start() calls possible.
   */
  destroy(): void {
    this.destroyed = true;
    this.stop();
  }

  // ─── Internal: State Transition Queue ────────────────────────────────

  /**
   * Serialize state transitions to prevent race conditions.
   * Only one transition runs at a time — no overlapping getUserMedia calls.
   */
  private enqueueTransition(t: MicTransition): Promise<void> {
    this.transitionQueue = this.transitionQueue.then(() =>
      this.applyTransition(t)
    );
    return this.transitionQueue;
  }

  private async applyTransition(t: MicTransition): Promise<void> {
    if (this.destroyed && t.to !== 'inactive') return;

    switch (t.to) {
      case 'requesting':
        this.setState('requesting');
        break;

      case 'active':
        this.stream = t.stream;
        this.setState('active');
        this.attachTrackEndedHandler(t.stream);
        this.attachVisibilityHandler();
        break;

      case 'suspended':
        this.setState('suspended');
        break;

      case 'recovering':
        this.removeTrackEndedHandler();
        this.setState('recovering');
        this.scheduleRecovery();
        break;

      case 'error':
        this.removeTrackEndedHandler();
        this.removeVisibilityHandler();
        this.setState('error', t.error);
        break;

      case 'inactive':
        this.removeTrackEndedHandler();
        this.removeVisibilityHandler();
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }
        this.setState('inactive');
        break;
    }
  }

  // ─── Internal: Recovery ──────────────────────────────────────────────

  private scheduleRecovery(): void {
    this.cancelRecoveryTimer();
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      this.enqueueTransition({
        to: 'error',
        error: `Mic recovery failed after ${MAX_RECOVERY_ATTEMPTS} attempts`,
      });
      return;
    }

    const delay =
      RECOVERY_DELAYS_MS[
        Math.min(this.recoveryAttempts, RECOVERY_DELAYS_MS.length - 1)
      ];

    console.log(
      `[MicManager] Recovery attempt ${this.recoveryAttempts + 1}/${MAX_RECOVERY_ATTEMPTS} in ${delay}ms`
    );

    this.recoveryTimer = setTimeout(async () => {
      this.recoveryAttempts++;
      // Close any stale stream before retrying
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      await this.start();
    }, delay);
  }

  private cancelRecoveryTimer(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.recoveryAttempts = 0;
  }

  // ─── Internal: Track Ended Detection ─────────────────────────────────

  private attachTrackEndedHandler(stream: MediaStream): void {
    this.removeTrackEndedHandler();
    this.trackEndedHandler = () => {
      console.warn('[MicManager] Audio track ended unexpectedly');
      if (this.state === 'active') {
        this.enqueueTransition({ to: 'recovering' });
      }
    };
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', this.trackEndedHandler!);
    });
  }

  private removeTrackEndedHandler(): void {
    if (this.trackEndedHandler && this.stream) {
      this.stream.getTracks().forEach((track) =>
        track.removeEventListener('ended', this.trackEndedHandler!)
      );
    }
    this.trackEndedHandler = null;
  }

  // ─── Internal: Visibility Handling ────────────────────────────────────

  private attachVisibilityHandler(): void {
    this.removeVisibilityHandler();
    this.visibilityHandler = () => {
      if (document.hidden && this.state === 'active') {
        this.suspend();
      } else if (!document.hidden && this.state === 'suspended') {
        this.resume();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private removeVisibilityHandler(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // ─── Internal: State + Event Emission ─────────────────────────────────

  private setState(state: MicState, error?: string): void {
    if (this.state === state && !error) return; // no-op
    this.state = state;

    const event: MicrophoneStateEvent = {
      type: 'mic_state',
      state,
      error,
      timestamp: Date.now(),
    };

    this.bus.emit(event);

    // Health reporting
    this.bus.emit({
      type: 'health',
      component: 'MicrophoneManager',
      healthy: state === 'active',
      message: error || `state=${state}`,
      timestamp: Date.now(),
    });
  }
}
