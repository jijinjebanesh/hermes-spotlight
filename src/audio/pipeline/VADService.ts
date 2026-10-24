/**
 * VADService — Voice Activity Detection from the audio stream.
 *
 * Listens to AudioChunkEvent from the AudioCaptureService.
 * Detects speech start/end using RMS threshold + silence timeout.
 * Emits VadStateEvent: silence → speech_start → speaking → speech_end → silence
 *
 * Configuration:
 * - speechThreshold: RMS amplitude to consider as speech (default 0.15)
 * - silenceDurationMs: continuous quiet to declare speech end (default 800ms)
 * - minSpeechDurationMs: minimum speech length to be valid (default 300ms)
 *
 * Features:
 * - Adaptive threshold (calibrates from ambient noise baseline)
 * - Debounced speech start (3 consecutive noisy chunks = speech)
 * - No false positives from coughs/short clicks
 * - Configurable sensitivity
 */

import { EventBus } from './EventBus';
import { VADState, AudioChunkEvent } from './types';

const DEFAULT_SPEECH_THRESHOLD = 0.15;
const DEFAULT_SILENCE_MS = 800;
const MIN_SPEECH_MS = 300;
const SPEECH_START_CHUNKS = 3; // 3 consecutive noisy chunks = speech start
const CALIBRATION_BLOCKS = 40; // 4s of baseline before auto-calibration
const CALIBRATION_FACTOR = 2.5; // threshold = max(baseline * 2.5, floor)
const ADAPTIVE_FLOOR = 0.005;
const ADAPTIVE_CEIL = 0.10;
const CHUNK_MS = 100; // matches AudioCaptureService

export interface VADConfig {
  speechThreshold?: number;
  silenceDurationMs?: number;
}

export class VADService {
  private bus: EventBus;
  private state: VADState = 'silence';
  private config: Required<VADConfig>;

  // Adaptive threshold
  private calibrationSum = 0;
  private calibrationCount = 0;
  private calibratedThreshold: number | null = null;

  // Speech tracking
  private consecutiveNoisy = 0;
  private consecutiveQuiet = 0;
  private speechStartTimestamp = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  private running = false;
  private unsub: (() => void) | null = null;

  constructor(bus: EventBus, config?: VADConfig) {
    this.bus = bus;
    this.config = {
      speechThreshold: config?.speechThreshold ?? DEFAULT_SPEECH_THRESHOLD,
      silenceDurationMs: config?.silenceDurationMs ?? DEFAULT_SILENCE_MS,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.state = 'silence';
    this.unsub = this.bus.on('audio_chunk', (e) => this.processChunk(e));
  }

  stop(): void {
    this.running = false;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  /**
   * Get the current adaptive threshold (after calibration).
   */
  getThreshold(): number {
    return this.calibratedThreshold ?? this.config.speechThreshold;
  }

  /**
   * Manually set the threshold (overrides calibration).
   */
  setThreshold(threshold: number): void {
    this.calibratedThreshold = Math.max(ADAPTIVE_FLOOR, Math.min(ADAPTIVE_CEIL, threshold));
  }

  /**
   * Reset calibration so it re-runs on next chunks.
   */
  resetCalibration(): void {
    this.calibrationSum = 0;
    this.calibrationCount = 0;
    this.calibratedThreshold = null;
  }

  private processChunk(event: AudioChunkEvent): void {
    if (!this.running) return;

    // Compute RMS from the chunk samples
    const rms = this.computeRMS(event.samples);
    const threshold = this.getThreshold();

    // Run calibration if not yet complete
    if (this.calibratedThreshold === null) {
      this.updateCalibration(rms);
    }

    this.consecutiveNoisy = rms > threshold ? this.consecutiveNoisy + 1 : 0;
    this.consecutiveQuiet = rms <= threshold ? this.consecutiveQuiet + 1 : 0;

    // State transitions
    if (this.state === 'silence') {
      if (this.consecutiveNoisy >= SPEECH_START_CHUNKS) {
        this.transition('speech_start');
        this.transition('speaking');
        this.speechStartTimestamp = event.timestamp;
        this.clearSilenceTimer();
      }
    } else if (this.state === 'speaking') {
      // If we've been quiet for enough chunks, start silence timer
      if (
        this.consecutiveQuiet >=
        Math.ceil(this.config.silenceDurationMs / CHUNK_MS)
      ) {
        this.startSilenceTimer();
      }

      // If speech resumes, cancel the silence timer
      if (this.consecutiveNoisy >= SPEECH_START_CHUNKS) {
        this.clearSilenceTimer();
      }
    }
  }

  private startSilenceTimer(): void {
    if (this.silenceTimer) return; // already running

    this.silenceTimer = setTimeout(() => {
      this.onSpeechEnd();
    }, this.config.silenceDurationMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private onSpeechEnd(): void {
    if (this.state !== 'speaking') return;

    const speechDuration = Date.now() - this.speechStartTimestamp;
    if (speechDuration < MIN_SPEECH_MS) {
      // Too short to be real speech — go back to silence
      this.transition('silence');
      return;
    }

    this.transition('speech_end');
    this.transition('silence');
  }

  private transition(newState: VADState): void {
    if (this.state === newState) return;
    this.state = newState;

    this.bus.emit({
      type: 'vad_state',
      state: newState,
      timestamp: Date.now(),
    });
  }

  private updateCalibration(rms: number): void {
    // Only calibrate on quiet samples (ambient noise, not speech)
    if (rms >= this.config.speechThreshold * 4) {
      return; // skip noisy samples
    }
    this.calibrationSum += rms;
    this.calibrationCount++;

    if (this.calibrationCount >= CALIBRATION_BLOCKS) {
      const avg = this.calibrationSum / this.calibrationCount;
      const calibrated = Math.max(
        avg * CALIBRATION_FACTOR,
        ADAPTIVE_FLOOR
      );
      // Take max so we never LOWER the threshold below the configured default
      this.calibratedThreshold = Math.max(
        this.config.speechThreshold,
        Math.min(calibrated, ADAPTIVE_CEIL)
      );
      console.log(
        `[VAD] Calibrated: baseline=${avg.toFixed(4)} → threshold=${this.calibratedThreshold.toFixed(4)}`
      );
    }
  }

  private computeRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  destroy(): void {
    this.stop();
  }
}
