/**
 * STTProvider — Pluggable Speech-to-Text interface.
 *
 * The STTProvider is an INTERFACE, not a concrete class.
 * The pipeline calls transcribe() or transcribeStream() only
 * through this interface. Swapping faster-whisper for Moonshine
 * is a config change, not a code change.
 *
 * Two modes:
 * 1. Batch mode: transcribe(arrayBuffer) → Promise<string>
 *    Used when VAD detects speech end and we need a final transcript.
 *
 * 2. Streaming mode: transcribeStream(chunkIterator) → AsyncIterator<PartialResult>
 *    Used for real-time partial transcripts while user is still speaking.
 *    (Optional — providers without streaming support just emit one final result.)
 */

export interface PartialResult {
  /** Partial transcript text (may be empty or incomplete) */
  text: string;
  /** Whether this is the final result for this audio */
  isFinal: boolean;
  /** Confidence score 0..1 (optional) */
  confidence?: number;
}

export interface STTConfig {
  /** Which STT engine to use */
  engine: 'faster-whisper' | 'web-speech';
  /** Model name (for faster-whisper: 'tiny.en', 'base', 'small', 'large-v3-turbo') */
  model?: string;
  /** Language code (e.g., 'en', 'auto' for auto-detect) */
  language?: string;
  /** Device: 'cuda' or 'cpu' (for faster-whisper) */
  device?: 'cuda' | 'cpu';
  /** Compute type: 'float16', 'int8', 'int8_float16' */
  computeType?: string;
}

export interface STTProvider {
  /**
   * Transcribe a complete audio segment (batch mode).
   * Called after VAD detects speech end.
   *
   * @param audio Float32Array PCM samples at 16kHz mono
   * @returns final transcript text
   */
  transcribe(audio: Float32Array): Promise<string>;

  /**
   * Stream partial transcripts while audio is still coming in.
   * Called when VAD detects speech_start (optional for providers).
   *
   * @param chunks Async iterator of audio chunks from AudioCaptureService
   * @returns Async iterator of partial results
   */
  transcribeStream?(
    chunks: AsyncIterable<Float32Array>
  ): AsyncIterable<PartialResult>;

  /** Initialize the provider (load model, connect to daemon, etc.) */
  init(): Promise<void>;

  /** Cleanup resources */
  destroy(): void;

  /** Provider health check */
  isHealthy(): boolean;

  /** Provider display name */
  readonly name: string;
}

// ─── Factory ─────────────────────────────────────────────────────────────

import { EventBus } from './EventBus';
import { FasterWhisperSTT } from '../providers/FasterWhisperSTT';
import { WebSpeechSTT } from '../providers/WebSpeechSTT';

export async function createSTTProvider(
  bus: EventBus,
  config: STTConfig
): Promise<STTProvider> {
  let provider: STTProvider;

  switch (config.engine) {
    case 'faster-whisper':
      provider = new FasterWhisperSTT(bus, config);
      break;
    case 'web-speech':
      provider = new WebSpeechSTT(bus);
      break;
    default:
      console.warn(`[STT] Unknown engine "${config.engine}", falling back to web-speech`);
      provider = new WebSpeechSTT(bus);
      break;
  }

  try {
    await provider.init();
    return provider;
  } catch (e) {
    console.error(`[STT] Failed to init ${config.engine}:`, e);
    // Fall back to web-speech if the primary provider fails
    if (config.engine !== 'web-speech') {
      console.warn('[STT] Falling back to WebSpeechSTT');
      const fallback = new WebSpeechSTT(bus);
      await fallback.init();
      return fallback;
    }
    throw e;
  }
}
