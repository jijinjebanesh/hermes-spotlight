/**
 * PlaybackManager — Gapless audio queue for TTS playback.
 *
 * Listens to TTSChunkEvent from TTSService. Plays audio blobs
 * sequentially as they arrive — never pauses between chunks.
 *
 * Features:
 * - Gapless playback queue (each blob starts immediately after the previous)
 * - Amplitude tracking via AnalyserNode (for renderer VU meter)
 * - Cancel/restart (interrupted → cancel current + clear queue)
 * - URL lifecycle management (revoke blob URLs after playback)
 * - PlaybackStateEvent emission (playing, ended, interrupted, idle)
 *
 * This does NOT own the AudioContext — it manages HTMLAudioElements.
 */

import { EventBus } from './EventBus';

interface QueuedChunk {
  blob: Blob;
  text: string;
  index: number;
}

export class PlaybackManager {
  private bus: EventBus;
  private ttsCtx: AudioContext | null = null;
  private ttsAnalyser: AnalyserNode | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private queue: QueuedChunk[] = [];
  private playing = false;
  private cancelled = false;
  private amplitudeFrame: number = 0;
  private unsub: (() => void) | null = null;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * Start listening for TTS chunks and playing them.
   */
  start(): void {
    if (this.unsub) return;
    this.cancelled = false;

    this.unsub = this.bus.on('tts_chunk', (e) => {
      this.enqueue(e.blob, e.text, e.index);
    });
  }

  /**
   * Stop playback and clear the queue.
   */
  stop(): void {
    this.cancelled = true;
    this.clearQueue();
    this.stopCurrentAudio();
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    cancelAnimationFrame(this.amplitudeFrame);
  }

  /**
   * Cancel all playback immediately (barge-in).
   */
  cancel(): void {
    this.cancelled = true;
    this.clearQueue();
    this.stopCurrentAudio();
    this.bus.emit({
      type: 'playback_state',
      state: 'interrupted',
      timestamp: Date.now(),
    });
    this.bus.emit({
      type: 'tts_amplitude',
      value: 0,
      timestamp: Date.now(),
    });
  }

  private enqueue(blob: Blob, text: string, index: number): void {
    if (this.cancelled) return;
    this.queue.push({ blob, text, index });
    if (!this.playing) {
      this.playNext();
    }
  }

  private clearQueue(): void {
    this.queue = [];
  }

  private playNext(): void {
    if (this.cancelled || this.queue.length === 0) {
      this.playing = false;
      if (!this.cancelled) {
        this.bus.emit({
          type: 'playback_state',
          state: 'ended',
          timestamp: Date.now(),
        });
      }
      return;
    }

    this.playing = true;
    const { blob, text, index } = this.queue.shift()!;
    const url = URL.createObjectURL(blob);
    this.currentUrl = url;
    this.currentAudio = new Audio(url);

    // Set up analyser for amplitude tracking
    this.setupAnalyser();

    this.bus.emit({
      type: 'playback_state',
      state: 'playing',
      timestamp: Date.now(),
    });

    this.currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      if (this.currentUrl === url) this.currentUrl = null;
      this.playNext();
    };

    this.currentAudio.onerror = () => {
      URL.revokeObjectURL(url);
      if (this.currentUrl === url) this.currentUrl = null;
      this.playNext();
    };

    this.currentAudio.play().catch(() => {
      URL.revokeObjectURL(url);
      if (this.currentUrl === url) this.currentUrl = null;
      this.playNext();
    });
  }

  private stopCurrentAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    this.bus.emit({
      type: 'tts_amplitude',
      value: 0,
      timestamp: Date.now(),
    });
    cancelAnimationFrame(this.amplitudeFrame);
  }

  private setupAnalyser(): void {
    try {
      if (!this.ttsCtx || this.ttsCtx.state === 'closed') {
        this.ttsCtx = new AudioContext();
      }
      if (this.ttsCtx.state === 'suspended') {
        this.ttsCtx.resume();
      }
      if (!this.currentAudio) return;

      const source = this.ttsCtx.createMediaElementSource(this.currentAudio);
      this.ttsAnalyser = this.ttsCtx.createAnalyser();
      this.ttsAnalyser.fftSize = 256;
      source.connect(this.ttsAnalyser);
      source.connect(this.ttsCtx.destination);
      this.startAmplitudeLoop();
    } catch (e) {
      console.warn('[Playback] Could not set up analyser:', e);
    }
  }

  private startAmplitudeLoop(): void {
    cancelAnimationFrame(this.amplitudeFrame);
    if (!this.ttsAnalyser) return;

    const dataArray = new Uint8Array(this.ttsAnalyser.frequencyBinCount);

    const loop = () => {
      if (!this.ttsAnalyser || this.cancelled) return;
      this.ttsAnalyser.getByteTimeDomainData(dataArray);
      const rms = this.computeRMS(dataArray);
      this.bus.emit({
        type: 'tts_amplitude',
        value: Math.min(rms * 3, 1),
        timestamp: Date.now(),
      });
      this.amplitudeFrame = requestAnimationFrame(loop);
    };
    this.amplitudeFrame = requestAnimationFrame(loop);
  }

  private computeRMS(data: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const norm = (data[i] - 128) / 128;
      sum += norm * norm;
    }
    return Math.sqrt(sum / data.length);
  }

  destroy(): void {
    this.stop();
    if (this.ttsCtx && this.ttsCtx.state !== 'closed') {
      this.ttsCtx.close().catch(() => {});
    }
    this.ttsCtx = null;
    this.ttsAnalyser = null;
  }
}
