/**
 * WebSpeechSTT — Fallback STT provider using the browser's Web Speech API.
 *
 * Uses the browser's built-in SpeechRecognition (webkitSpeechRecognition).
 * This is the FALLBACK provider — used when:
 * - faster-whisper daemon fails to start
 * - GPU is not available
 * - User has no Python environment
 * - Model download fails
 *
 * Web Speech API provides:
 * - Free, no API key, no Python required
 * - True streaming (interim results while speaking)
 * - Chrome/Edge on Windows: high quality, Google's servers
 *
 * Limitations:
 * - Requires network (speech recognition happens in the cloud)
 * - Browser-specific (only Chrome/Edge)
 * - No control over the model
 * - Can timeout after extended silence
 */

import { EventBus } from '../pipeline/EventBus';
import { STTProvider, PartialResult } from '../pipeline/STTProvider';

export class WebSpeechSTT implements STTProvider {
  readonly name = 'web-speech';
  private bus: EventBus;
  private healthy = false;
  private initialized = false;
  private recognition: any = null;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.healthy = false;
      throw new Error('Web Speech API not available in this browser');
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.healthy = true;
    this.initialized = true;

    this.bus.emit({
      type: 'health',
      component: 'WebSpeechSTT',
      healthy: true,
      message: 'Web Speech API initialized',
      timestamp: Date.now(),
    });
  }

  /**
   * For batch mode, Web Speech API doesn't make sense — it's inherently
   * streaming. But we support it by starting recognition, waiting for
   * a final result, and returning it.
   *
   * In practice, this provider is only used as a fallback during
   * streaming (transcribeStream), not for batch mode.
   */
  async transcribe(audio: Float32Array): Promise<string> {
    // Web Speech API can't transcribe arbitrary audio buffers
    // Return empty — the streaming path is what matters
    console.warn('[WebSpeech] Batch transcribe not supported — use transcribeStream');
    return '';
  }

  /**
   * Web Speech API is inherently streaming — it provides interim results
   * while the user is still speaking. This is the primary path for this
   * provider.
   *
   * NOTE: The Web Speech API manages its own audio capture internally.
   * It does NOT use the audio chunks from AudioCaptureService.
   * So this provider acts as a direct listener, taking over the audio
   * pipeline when active.
   */
  async *transcribeStream(
    _chunks: AsyncIterable<Float32Array>
  ): AsyncIterable<PartialResult> {
    // This provider ignores the chunks parameter — it has its own audio
    // capture. The actual Web Speech recognition is handled directly
    // by the WebSpeechController (see below), not this generator.
    //
    // We yield a no-op so the AsyncIterable works if called.
    yield { text: '', isFinal: true };
  }

  /**
   * Start the Web Speech recognition with result callbacks.
   * This is the actual streaming mechanism — callbacks emit events.
   */
  startRecognition(
    onPartial: (text: string) => void,
    onFinal: (text: string) => void
  ): void {
    if (!this.recognition) {
      console.error('[WebSpeech] Not initialized');
      return;
    }

    this.recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) {
        onFinal(final.trim());
      }
      if (interim) {
        onPartial(interim.trim());
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[WebSpeech] Error:', event.error);
        this.bus.emit({
          type: 'pipeline_error',
          source: 'WebSpeechSTT',
          message: `recognition error: ${event.error}`,
          severity: 'recoverable',
          timestamp: Date.now(),
        });
      }
    };

    this.recognition.onend = () => {
      // Auto-restart if we haven't been told to stop
      try {
        this.recognition.start();
      } catch {
        // already started or inaled
      }
    };

    try {
      this.recognition.start();
    } catch {
      // already started
    }
  }

  stopRecognition(): void {
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  destroy(): void {
    this.stopRecognition();
    this.healthy = false;
    this.initialized = false;
    this.recognition = null;
  }
}
