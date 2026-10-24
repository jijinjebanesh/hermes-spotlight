/**
 * LLMStreamingService — Streams LLM responses via Hermes CLI IPC.
 *
 * Extracts the LLM communication logic from the old EchoEngine.sendToAgent().
 *
 * Flow:
 * 1. ConversationManager emits transcript_update with the user's text
 * 2. LLMStreamingService sends text to Hermes via echoSendMessage IPC
 * 3. Hermes streams response chunks back via echoStreamChunk IPC
 * 4. LLMStreamingService emits LLMChunkEvent for each chunk
 * 5. TTSService listens and synthesizes text chunks → audio
 *
 * Features:
 * - Streaming: text chunks arrive in real-time, not all at once
 * - Screenshot context injection (for "what am I looking at" queries)
 * - 120s timeout with graceful error recovery
 * - LLM chunk text accumulation
 */

import { EventBus } from './EventBus';

const LLM_TIMEOUT_MS = 120_000;

export interface LLMOptions {
  /** Provider override (e.g., 'openrouter', 'anthropic') */
  provider?: string;
  /** Model override */
  model?: string;
  /** Image path for screen context queries */
  imagePath?: string;
}

export class LLMStreamingService {
  private bus: EventBus;
  private provider: string | undefined;
  private model: string | undefined;
  private currentRequest: AbortController | null = null;
  private currentRequestId: string | null = null;

  constructor(bus: EventBus, opts?: { provider?: string; model?: string }) {
    this.bus = bus;
    this.provider = opts?.provider;
    this.model = opts?.model;
  }

  /**
   * Send user text to the LLM and stream the response.
   * Emits LLMChunkEvent for each text chunk.
   *
   * The `text` may contain __SCREEN_CONTEXT__ prefix which signals
   * that a screenshot should be attached to the request.
   */
  async send(
    text: string,
    opts?: LLMOptions
  ): Promise<string> {
    // Cancel any in-flight request
    this.cancel();

    this.currentRequest = new AbortController();
    const signal = this.currentRequest.signal;
    const requestId = `echo-v2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentRequestId = requestId;

    // Parse screen context prefix
    let agentText = text;
    let imagePath: string | undefined = opts?.imagePath;

    if (agentText.startsWith('__SCREEN_CONTEXT__')) {
      agentText = agentText.substring('__SCREEN_CONTEXT__'.length);
      // Screenshot capture is handled by the IPC handler in EchoEngine
      if (!imagePath) {
        try {
          const screenshot = await (window as any).electronAPI.captureScreenshot();
          if (screenshot?.path) {
            imagePath = screenshot.path;
            agentText = `<file name="${screenshot.name}" path="${screenshot.path}" type="image">[Screenshot captured]</file>\n\n${agentText}`;
          }
        } catch (e) {
          console.warn('[LLM] Screenshot capture failed:', e);
        }
      }
    }

    let fullResponse = '';
    let currentBuffer = '';

    // Subscribe to stream chunks from IPC
    const unsubscribe = (window as any).electronAPI.onEchoStreamChunk((event: { requestId: string; chunk: string }) => {
      if (signal.aborted || event.requestId !== requestId) return;
      const chunk = event.chunk;

      fullResponse += chunk;
      currentBuffer += chunk;

      // Emit each chunk as it arrives
      this.bus.emit({
        type: 'llm_chunk',
        text: chunk,
        isFinal: false,
        timestamp: Date.now(),
      });

      // Also emit accumulated full response for the renderer
      // (The renderer uses this to update the agent text bubble)
    });

    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT_MS);
    });

    try {
      const responsePromise = (window as any).electronAPI.echoSendMessage({
        text: agentText,
        imagePath,
        requestId,
      });

      // Wait for either the response or the timeout
      await Promise.race([responsePromise, timeoutPromise]);
    } catch (e) {
      if (signal.aborted) {
        console.log('[LLM] Request canceled');
      } else {
        console.error('[LLM] Request failed:', e);
        this.bus.emit({
          type: 'pipeline_error',
          source: 'LLMStreamingService',
          message: e instanceof Error ? e.message : String(e),
          severity: 'recoverable',
          timestamp: Date.now(),
        });
      }
    } finally {
      unsubscribe();
    }

    // Emit final chunk (for any trailing text)
    if (currentBuffer.trim()) {
      this.bus.emit({
        type: 'llm_chunk',
        text: '',
        isFinal: true,
        timestamp: Date.now(),
      });
    }

    if (this.currentRequestId === requestId) {
      this.currentRequest = null;
      this.currentRequestId = null;
    }
    return fullResponse;
  }

  /**
   * Cancel the current LLM request.
   */
  cancel(): void {
    if (this.currentRequest) {
      this.currentRequest.abort();
      this.currentRequest = null;
    }
    if (this.currentRequestId) {
      (window as any).electronAPI.cancelEchoMessage(this.currentRequestId);
      this.currentRequestId = null;
    }
  }

  /**
   * Update provider/model settings.
   */
  setProvider(provider?: string, model?: string): void {
    this.provider = provider;
    this.model = model;
  }

  destroy(): void {
    this.cancel();
  }
}
