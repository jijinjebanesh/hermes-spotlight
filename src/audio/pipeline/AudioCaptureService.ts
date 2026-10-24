/**
 * AudioCaptureService — Raw audio chunk extraction from the MicrophoneManager.
 *
 * Listens to mic_state events. When the mic becomes active, it creates an
 * AudioContext + AnalyserNode + ScriptProcessor (or AudioWorklet) to extract
 * raw PCM float32 samples from the live stream. Emits AudioChunkEvent and
 * MicAmplitudeEvent at regular intervals.
 *
 * Design:
 * - Does NOT own the MediaStream (MicrophoneManager does)
 * - Reads the stream via getStream() only when state == 'active'
 * - AudioContext is created lazily and reused across suspend/resume
 * - Sample rate normalized to 16kHz for STT compatibility
 * - Chunk interval configurable (default 100ms = 1600 samples @ 16kHz)
 * - Diverted amplitude for the renderer's VU meter
 */

import { EventBus } from './EventBus';
import { MicState } from './types';
import type { MicrophoneManager } from './MicrophoneManager';

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_INTERVAL_MS = 100; // emit chunks every 100ms
const CHUNK_SAMPLES = (TARGET_SAMPLE_RATE * CHUNK_INTERVAL_MS) / 1000; // 1600
const ANALYSER_FFT_SIZE = 256;

export class AudioCaptureService {
  private bus: EventBus;
  private mic: MicrophoneManager;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private amplitudeBuffer: Uint8Array;
  private chunkBuffer: Float32Array;
  private chunkOffset = 0;
  private startTime = 0;
  private running = false;
  private cleanupFn: (() => void) | null = null;

  constructor(bus: EventBus, mic: MicrophoneManager) {
    this.bus = bus;
    this.mic = mic;
    this.amplitudeBuffer = new Uint8Array(ANALYSER_FFT_SIZE);
    this.chunkBuffer = new Float32Array(CHUNK_SAMPLES);

    // Subscribe to mic state changes
    this.bus.on('mic_state', (event) => {
      if (event.state === 'active') {
        this.startCapture();
      } else if (event.state === 'inactive' || event.state === 'error') {
        this.stopCapture();
      }
      // On 'suspended' or 'recovering', we just pause — the AudioContext
      // gets suspended automatically. On resume, it resumes.
    });
  }

  private startCapture(): void {
    const stream = this.mic.getStream();
    if (!stream) {
      console.error('[AudioCapture] No stream available from MicrophoneManager');
      return;
    }
    if (this.running) return;
    this.running = true;

    try {
      // Create AudioContext (or reuse existing)
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = ANALYSER_FFT_SIZE;
      this.sourceNode.connect(this.analyser);

      // ScriptProcessor for raw PCM extraction
      // Buffer size must be a power of 2: 4096 = 256ms @ 16kHz
      this.scriptNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!this.running) return;
        this.processAudio(e);
      };
      this.sourceNode.connect(this.scriptNode);
      // ScriptProcessor must connect to destination to fire onaudioprocess
      this.scriptNode.connect(this.audioCtx.destination);

      this.startTime = Date.now();
      this.chunkOffset = 0;
      console.log('[AudioCapture] Started — 16kHz, 100ms chunks');
    } catch (e) {
      console.error('[AudioCapture] Failed to start:', e);
      this.bus.emit({
        type: 'pipeline_error',
        source: 'AudioCaptureService',
        message: `Failed to start capture: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'recoverable',
        timestamp: Date.now(),
      });
    }
  }

  private processAudio(e: AudioProcessingEvent): void {
    if (!this.audioCtx || !this.analyser) return;

    const inputBuffer = e.inputBuffer.getChannelData(0);

    // Push samples into the chunk buffer
    const remaining = this.chunkBuffer.length - this.chunkOffset;
    const toCopy = Math.min(inputBuffer.length, remaining);
    for (let i = 0; i < toCopy; i++) {
      this.chunkBuffer[this.chunkOffset + i] = inputBuffer[i];
    }
    this.chunkOffset += toCopy;

    // Emit amplitude (for VU meter in renderer)
    this.analyser.getByteTimeDomainData(this.amplitudeBuffer);
    const rms = this.computeRMS(this.amplitudeBuffer);
    this.bus.emit({
      type: 'amplitude',
      value: Math.min(rms * 3, 1),
      timestamp: Date.now(),
    });

    // When chunk buffer is full, emit an AudioChunkEvent
    if (this.chunkOffset >= this.chunkBuffer.length) {
      const chunk = this.chunkBuffer.slice(0);
      this.bus.emit({
        type: 'audio_chunk',
        samples: chunk,
        sampleRate: TARGET_SAMPLE_RATE,
        timestamp: Date.now() - this.startTime,
      });
      this.chunkOffset = 0;
    }
  }

  private stopCapture(): void {
    this.running = false;
    try {
      if (this.scriptNode) {
        this.scriptNode.disconnect();
        this.scriptNode.onaudioprocess = null;
        this.scriptNode = null;
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      this.analyser = null;
    } catch {
      // ignore cleanup errors
    }
    // Don't close the AudioContext here — it may be reused on resume
  }

  /**
   * Permanently clean up all audio resources.
   */
  destroy(): void {
    this.stopCapture();
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
  }

  private computeRMS(data: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const norm = (data[i] - 128) / 128;
      sum += norm * norm;
    }
    return Math.sqrt(sum / data.length);
  }
}
