/**
 * EchoEngine V2 — Thin orchestrator for the modular voice pipeline.
 *
 * Unlike the old EchoEngine (787 lines), this does NOT own any audio
 * resources, STT, LLM, or TTS logic. It simply:
 * 1. Creates all pipeline modules
 * 2. Wires EventBus subscriptions
 * 3. Maps pipeline events to renderer callbacks
 * 4. Manages pipeline lifecycle (start, stop, interrupt)
 *
 * Every module is independently testable. STT is pluggable via config.
 * MicrophoneManager owns the mic. ConversationManager owns the state.
 * This class owns nothing except the EventBus and module references.
 */

import { EventBus } from './pipeline/EventBus';
import { MicrophoneManager } from './pipeline/MicrophoneManager';
import { AudioCaptureService } from './pipeline/AudioCaptureService';
import { VADService } from './pipeline/VADService';
import { ActivationManager } from './pipeline/ActivationManager';
import { ConversationManager } from './pipeline/ConversationManager';
import { LLMStreamingService } from './pipeline/LLMStreamingService';
import { TTSService } from './pipeline/TTSService';
import { PlaybackManager } from './pipeline/PlaybackManager';
import { InterruptManager } from './pipeline/InterruptManager';
import { createSTTProvider, STTProvider, STTConfig } from './pipeline/STTProvider';
import { EchoState } from './pipeline/types';

// Re-export EchoState for backward compatibility with renderer code
export type { EchoState } from './pipeline/types';

export interface EchoEngineCallbacks {
  onStateChange: (state: EchoState) => void;
  onTranscriptUpdate: (text: string) => void;
  onInterimTranscriptUpdate: (text: string) => void;
  onAgentTextUpdate: (text: string) => void;
  onAmplitudeUpdate: (amplitude: number) => void;
  onTtsChunkStart: (chunkText: string) => void;
  onExit: () => void;
}

export interface EchoEngineConfig {
  /** STT engine config */
  stt?: Partial<STTConfig>;
  /** TTS voice */
  ttsVoice?: string;
  /** TTS provider */
  ttsProvider?: string;
  /** Exit words */
  exitWords?: string[];
  /** Interrupt words */
  interruptWords?: string[];
  /** VAD speech threshold */
  vadThreshold?: number;
  /** VAD silence duration */
  vadSilenceMs?: number;
  /** LLM provider */
  llmProvider?: string;
  /** LLM model */
  llmModel?: string;
}

// Map to old EchoState type for renderer compatibility
type OldEchoState =
  | 'initializing'
  | 'listening'
  | 'processing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export class EchoEngine {
  // Pipeline
  private bus = new EventBus();
  private mic: MicrophoneManager;
  private capture: AudioCaptureService;
  private vad: VADService;
  private activation: ActivationManager;
  private stt: STTProvider | null = null;
  private conversation: ConversationManager;
  private llm: LLMStreamingService;
  private tts: TTSService;
  private playback: PlaybackManager;
  private interrupt: InterruptManager;

  // State
  private callbacks: EchoEngineCallbacks;
  private config: EchoEngineConfig;
  private isDestroyed = false;
  private isRunning = false;

  // Audio chunk accumulator for STT (VAD speech segment)
  private speechBuffer: Float32Array[] = [];
  private isCapturingSpeech = false;

  // STT partial — for interim transcript display
  private partialUnsub: (() => void) | null = null;

  constructor(callbacks: EchoEngineCallbacks, config?: EchoEngineConfig) {
    this.callbacks = callbacks;
    this.config = config || {};

    // Create all pipeline modules
    this.mic = new MicrophoneManager(this.bus);
    this.capture = new AudioCaptureService(this.bus, this.mic);
    this.vad = new VADService(this.bus, {
      speechThreshold: this.config.vadThreshold,
      silenceDurationMs: this.config.vadSilenceMs,
    });
    this.activation = new ActivationManager(this.bus);
    this.conversation = new ConversationManager(this.bus, {
      exitWords: this.config.exitWords,
    });
    this.llm = new LLMStreamingService(this.bus, {
      provider: this.config.llmProvider,
      model: this.config.llmModel,
    });
    this.tts = new TTSService(this.bus, {
      voice: this.config.ttsVoice,
      provider: this.config.ttsProvider,
    });
    this.playback = new PlaybackManager(this.bus);
    this.interrupt = new InterruptManager(this.bus, {
      interruptWords: this.config.interruptWords,
    });

    this.setupEventWiring();
  }

  async start(): Promise<void> {
    if (this.isDestroyed || this.isRunning) return;
    this.isRunning = true;

    // Emit initializing state
    this.callbacks.onStateChange('initializing');

    // Initialize STT provider
    const sttConfig: STTConfig = {
      engine: this.config.stt?.engine || 'faster-whisper',
      model: this.config.stt?.model || 'base',
      language: this.config.stt?.language || 'en',
      device: this.config.stt?.device || 'cuda',
      computeType: this.config.stt?.computeType || 'int8',
    };

    try {
      this.stt = await createSTTProvider(this.bus, sttConfig);
    } catch (e) {
      console.error('[EchoEngine] STT init failed:', e);
      this.callbacks.onStateChange('error');
      return;
    }

    // Start all services
    this.vad.start();
    this.activation.start();
    this.conversation.start();
    this.tts.start();
    this.playback.start();
    this.interrupt.start();

    // Start the microphone
    await this.mic.start();

    // If mic failed, the state will be 'error' from the mic_state event
    // If mic succeeded, conversation manager will transition to 'listening'
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.isRunning = false;

    this.bus.emit({
      type: 'pipeline_stop',
      timestamp: Date.now(),
    });

    if (this.stt) this.stt.destroy();
    this.interrupt.destroy();
    this.playback.destroy();
    this.tts.destroy();
    this.conversation.destroy();
    this.activation.destroy();
    this.vad.destroy();
    this.capture.destroy();
    this.mic.destroy();

    if (this.partialUnsub) this.partialUnsub();

    this.bus.removeAllListeners();
  }

  // ─── Public API (backward-compatible with old EchoEngine) ────────────

  /** Push-to-talk: start recording immediately */
  async startPushToTalk(): Promise<void> {
    if (this.isDestroyed) return;
    this.activation.emitActivation('push_to_talk', 'manual');
    this.isCapturingSpeech = true;
    this.speechBuffer = [];
  }

  /** Push-to-talk: stop recording and send */
  async stopPushToTalkAndSend(): Promise<void> {
    if (this.isDestroyed || !this.isCapturingSpeech) return;
    this.isCapturingSpeech = false;

    // Transcribe accumulated speech
    if (this.speechBuffer.length > 0 && this.stt) {
      const combined = this.concatFloat32(this.speechBuffer);
      this.speechBuffer = [];

      const transcript = await this.stt.transcribe(combined);
      if (transcript.trim()) {
        // Route through conversation manager
        this.bus.emit({
          type: 'transcript_update',
          text: transcript,
          timestamp: Date.now(),
        });
        // Trigger conversation flow
        this.handleTranscript(transcript);
      }
    }
  }

  /** Send a typed text message (bypasses STT) */
  async sendTextMessage(text: string): Promise<void> {
    if (this.isDestroyed || !text.trim()) return;
    this.handleTranscript(text);
  }

  /**
   * Mute/unmute the microphone.
   */
  setMuted(muted: boolean): void {
    const stream = this.mic.getStream();
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  /**
   * Get the current microphone stream (for OS-level mute detection).
   */
  getMicStream(): MediaStream | null {
    return this.mic.getStream();
  }

  // ─── Internal: Event Wiring ──────────────────────────────────────────

  private setupEventWiring(): void {
    // ─── Conversation state → renderer callback ───
    this.bus.on('conversation_state', (e) => {
      this.callbacks.onStateChange(e.state as EchoState);
    });

    // ─── Transcript updates → renderer ───
    this.bus.on('transcript_update', (e) => {
      // Distinguish user transcript from agent text by checking conversation state
      const state = this.conversation.getState();
      if (state === 'thinking' || state === 'speaking') {
        // Agent text being accumulated
        this.callbacks.onAgentTextUpdate(e.text);
      } else {
        // User transcript
        this.callbacks.onTranscriptUpdate(e.text);
      }
    });

    // ─── VAD: capture audio chunks during speech ───
    this.bus.on('vad_state', (e) => {
      if (e.state === 'speech_start') {
        this.isCapturingSpeech = true;
        this.speechBuffer = [];
      } else if (e.state === 'speech_end') {
        this.isCapturingSpeech = false;
        this.transcribeSpeech();
      }
    });

    // ─── Audio chunks → accumulate during speech ───
    this.bus.on('audio_chunk', (e) => {
      if (this.isCapturingSpeech) {
        this.speechBuffer.push(e.samples);
      }
    });

    // ─── Amplitude → renderer ───
    this.bus.on('amplitude', (e) => {
      this.callbacks.onAmplitudeUpdate(e.value);
    });
    this.bus.on('tts_amplitude', (e) => {
      this.callbacks.onAmplitudeUpdate(e.value);
    });

    // ─── TTS chunk start → renderer word highlighting ───
    this.bus.on('tts_chunk_start', (e) => {
      this.callbacks.onTtsChunkStart(e.text);
    });

    // ─── Exit → renderer ───
    this.bus.on('exit', () => {
      this.callbacks.onExit();
    });

    // ─── LLM chunk → accumulate agent text ───
    let agentText = '';
    this.bus.on('llm_chunk', (e) => {
      agentText += e.text;
      this.callbacks.onAgentTextUpdate(agentText);
    });

    // ─── Interrupt → cancel TTS and LLM ───
    this.bus.on('interrupt', () => {
      this.tts.stop();
      this.playback.cancel();
      this.llm.cancel();
      // Restart TTS listener for next turn
      this.tts.start();
    });

    // ─── Playback ended → speak remaining TTS buffer, then restart ───
    this.bus.on('playback_state', async (e) => {
      if (e.state === 'ended') {
        // Speak any remaining text in the TTS buffer
        await this.tts.speakRemaining();
        // Reset agent text accumulator
        agentText = '';
      }
    });

    // ─── Conversation state → trigger LLM ───
    this.bus.on('conversation_state', (e) => {
      if (e.state === 'thinking' && this.currentTranscript) {
        this.sendToLLM(this.currentTranscript);
      }
    });

    // ─── Health monitoring (debug) ───
    this.bus.on('pipeline_error', (e) => {
      console.error(`[EchoEngine] Pipeline error from ${e.source}: ${e.message} (${e.severity})`);
    });
  }

  // ─── Internal: STT ───────────────────────────────────────────────────

  private currentTranscript: string | null = null;

  private async transcribeSpeech(): Promise<void> {
    if (this.speechBuffer.length === 0) return;

    // Transition to processing
    this.bus.emit({
      type: 'conversation_state',
      state: 'processing' as EchoState,
      timestamp: Date.now(),
    });

    if (!this.stt) return;

    const combined = this.concatFloat32(this.speechBuffer);
    this.speechBuffer = [];

    try {
      const transcript = await this.stt.transcribe(combined);
      if (transcript.trim()) {
        this.handleTranscript(transcript);
      } else {
        // Empty transcript — go back to listening
        this.bus.emit({
          type: 'conversation_state',
          state: 'listening' as EchoState,
          timestamp: Date.now(),
        });
      }
    } catch (e) {
      console.error('[EchoEngine] STT error:', e);
      this.bus.emit({
        type: 'conversation_state',
        state: 'listening' as EchoState,
        timestamp: Date.now(),
      });
    }
  }

  private handleTranscript(text: string): void {
    if (!text.trim()) return;

    // Check for screen context
    let agentText = text;
    const lower = text.toLowerCase();
    if (this.isScreenContextPhrase(lower)) {
      agentText = `__SCREEN_CONTEXT__${text}`;
    }

    this.currentTranscript = agentText;
    this.callbacks.onTranscriptUpdate(text);

    // Transition to thinking — the event listener will trigger LLM
    this.bus.emit({
      type: 'conversation_state',
      state: 'thinking' as EchoState,
      timestamp: Date.now(),
    });
  }

  private async sendToLLM(text: string): Promise<void> {
    this.currentTranscript = null; // consume

    // Reset agent text accumulator
    let fullResponse = '';
    const unsub = this.bus.on('llm_chunk', (e) => {
      fullResponse += e.text;
      this.callbacks.onAgentTextUpdate(fullResponse);
    });

    try {
      await this.llm.send(text);
    } catch (e) {
      console.error('[EchoEngine] LLM error:', e);
      this.bus.emit({
        type: 'conversation_state',
        state: 'listening' as EchoState,
        timestamp: Date.now(),
      });
    } finally {
      unsub();
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private isScreenContextPhrase(phrase: string): boolean {
    const triggers = [
      'what am i looking at',
      'see my screen',
      'look at my screen',
      'screenshot',
      'capture screen',
      'what is on my screen',
      'show me my screen',
      'what do you see',
    ];
    return triggers.some((t) => phrase.includes(t));
  }

  private concatFloat32(arrays: Float32Array[]): Float32Array {
    let totalLength = 0;
    for (const a of arrays) totalLength += a.length;
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const a of arrays) {
      result.set(a, offset);
      offset += a.length;
    }
    return result;
  }
}
