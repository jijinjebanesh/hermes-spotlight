/**
 * TTSService — Streaming Text-to-Speech synthesis.
 *
 * Listens to LLMChunkEvent. Accumulates text until a sentence boundary
 * is found, then synthesizes that chunk via IPC and emits TTSChunkEvent.
 *
 * The chunk boundary logic extracts from EchoEngine.sendToAgent:
 * - Split at sentence enders: . ! ? ;
 * - Split at commas for more frequent chunks
 * - Force-split at 80 chars if no natural boundary
 * - Speak remaining buffer at the end
 *
 * Features:
 * - Streaming synthesis (starts before LLM finishes)
 * - Calls Electron IPC synthesizeSpeech for each text chunk
 * - Emits tts_chunk_start for renderer word highlighting
 * - Emits tts_chunk (audio blob) for PlaybackManager
 * - Cancellable (via InterruptManager)
 *
 * Provider: edge-tts (default, free), elevenlabs, openai, qwen3
 */

import { EventBus } from './EventBus';

const MAX_CHUNK_LENGTH = 80;

export interface TTSOptions {
  voice?: string;
  provider?: string;
}

export class TTSService {
  private bus: EventBus;
  private opts: TTSOptions;
  private textBuffer = '';
  private fullResponse = '';
  private chunkIndex = 0;
  private cancelled = false;
  private playQueue: Promise<void> = Promise.resolve();
  private unsub: (() => void) | null = null;

  constructor(bus: EventBus, opts?: TTSOptions) {
    this.bus = bus;
    this.opts = opts || {};
  }

  /**
   * Start listening for LLM chunks and synthesizing TTS.
   */
  start(): void {
    if (this.unsub) return;

    this.cancelled = false;
    this.textBuffer = '';
    this.fullResponse = '';
    this.chunkIndex = 0;

    this.unsub = this.bus.on('llm_chunk', (e) => {
      if (this.cancelled || e.isFinal) return;
      this.handleLLMChunk(e.text);
    });
  }

  /**
   * Stop synthesizing. Cancels all pending chunks.
   */
  stop(): void {
    this.cancelled = true;
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.textBuffer = '';
  }

  /**
   * Set the voice and provider for TTS synthesis.
   */
  setOptions(opts: TTSOptions): void {
    this.opts = { ...this.opts, ...opts };
  }

  /**
   * Speak any remaining buffer — call this when LLM finishes.
   * Returns a promise that resolves when the last chunk is queued.
   */
  async speakRemaining(): Promise<void> {
    if (this.cancelled || !this.textBuffer.trim()) {
      return;
    }

    const textToSpeak = this.textBuffer.trim();
    this.textBuffer = '';
    await this.synthesizeChunk(textToSpeak);

    // Wait for all queued chunks to be synthesized
    await this.playQueue;
  }

  /**
   * Wait for all pending TTS synth operations to complete.
   */
  async waitForCompletion(): Promise<void> {
    await this.playQueue;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private handleLLMChunk(chunk: string): void {
    if (this.cancelled) return;

    this.fullResponse += chunk;
    this.textBuffer += chunk;

    // Emit accumulated full response for the renderer
    this.bus.emit({
      type: 'transcript_update',
      text: this.fullResponse,
      timestamp: Date.now(),
    });

    // Look for sentence boundaries
    const sentenceMatch = this.textBuffer.match(/^([^.!?;]+[.!?;]\s*)/);
    const clauseMatch = this.textBuffer.match(/^([^,]+,\s*)/);

    let textToSpeak = '';
    if (sentenceMatch && sentenceMatch[1].trim().length > 0) {
      textToSpeak = sentenceMatch[1].trim();
      this.textBuffer = this.textBuffer.substring(sentenceMatch[0].length);
    } else if (this.textBuffer.length > MAX_CHUNK_LENGTH) {
      // No sentence boundary but buffer is long — split at last natural break
      const commaBreak = this.textBuffer.lastIndexOf(', ');
      const spaceBreak = this.textBuffer.lastIndexOf(' ');
      const breakPoint =
        commaBreak > 0 ? commaBreak + 2 : spaceBreak > 0 ? spaceBreak + 1 : -1;
      if (
        breakPoint > 0 &&
        breakPoint < this.textBuffer.length - 10
      ) {
        textToSpeak = this.textBuffer.substring(0, breakPoint).trim();
        this.textBuffer = this.textBuffer.substring(breakPoint);
      } else {
        // No good break — force-split at MAX_CHUNK_LENGTH
        const forcePoint = Math.min(MAX_CHUNK_LENGTH, this.textBuffer.length);
        textToSpeak = this.textBuffer.substring(0, forcePoint).trim();
        this.textBuffer = this.textBuffer.substring(forcePoint);
      }
    }

    if (textToSpeak.length > 0) {
      this.synthesizeChunk(textToSpeak);
    }
  }

  private async synthesizeChunk(text: string): Promise<void> {
    if (this.cancelled || !text.trim()) return;

    const myIndex = this.chunkIndex++;
    const { voice, provider } = this.opts;

    this.playQueue = this.playQueue.then(async () => {
      if (this.cancelled) return;
      try {
        // Emit chunk start (for renderer word highlighting)
        this.bus.emit({
          type: 'tts_chunk_start',
          text,
          index: myIndex,
          timestamp: Date.now(),
        });

        const audioArray: number[] = await (
          window as any
        ).electronAPI.synthesizeSpeech({ text, voice, provider });

        if (!audioArray || audioArray.length === 0 || this.cancelled) return;

        // Convert array to blob
        const audioBuffer = new Uint8Array(audioArray).buffer;
        const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });

        this.bus.emit({
          type: 'tts_chunk',
          blob,
          text,
          index: myIndex,
          timestamp: Date.now(),
        });
      } catch (e) {
        console.error('[TTS] Chunk synth error:', e);
        this.bus.emit({
          type: 'pipeline_error',
          source: 'TTSService',
          message: e instanceof Error ? e.message : String(e),
          severity: 'recoverable',
          timestamp: Date.now(),
        });
      }
    });
  }

  destroy(): void {
    this.stop();
  }
}
