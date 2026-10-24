/**
 * InterruptManager — Barge-in detection and response cancellation.
 *
 * When the agent is speaking (TTS playing), monitors the microphone
 * for user speech. If the user starts talking during TTS playback,
 * immediately cancels the TTS, LLM stream, and returns to listening.
 *
 * Two detection modes:
 * 1. VAD-based: Uses VADService speech_start events (primary)
 *    - VAD already monitors the mic during speaking state
 *    - If speech_start fires while conversation_state == 'speaking', interrupt
 *
 * 2. Web Speech API fallback: runs a separate SpeechRecognition watcher
 *    during TTS playback, listening for interrupt words
 *    - More accurate (keyword-based) but more resource-intensive
 *    - Only used if VAD is not reliable enough for barge-in
 *
 * Interrupt words: configurable list (default: 'stop', 'wait', 'shut up', 'hey hermes')
 *
 * On interrupt:
 * - Emits InterruptEvent (source: 'barge_in')
 * - TTSService cancels all pending chunks
 * - PlaybackManager stops immediately
 * - LLMStreamingService cancels the request
 * - ConversationManager transitions to 'interrupted' then 'listening'
 */

import { EventBus } from './EventBus';

const DEFAULT_INTERRUPT_WORDS = ['stop', 'wait', 'shut up', 'hey hermes'];

export interface InterruptConfig {
  /** Words that trigger an interrupt during TTS playback */
  interruptWords?: string[];
  /** Whether to use Web Speech API for word-based interrupt detection */
  useWebSpeechFallback?: boolean;
}

export class InterruptManager {
  private bus: EventBus;
  private config: Required<InterruptConfig>;
  private interrupting = false;
  private webSpeechWatcher: any = null;
  private unsubs: (() => void)[] = [];

  /** Current conversation state — set by listening to conversation_state */
  private conversationState: string = 'initializing';

  constructor(bus: EventBus, config?: InterruptConfig) {
    this.bus = bus;
    this.config = {
      interruptWords: config?.interruptWords ?? DEFAULT_INTERRUPT_WORDS,
      useWebSpeechFallback: config?.useWebSpeechFallback ?? true,
    };
  }

  start(): void {
    // Track conversation state
    this.unsubs.push(
      this.bus.on('conversation_state', (e) => {
        const prevState = this.conversationState;
        this.conversationState = e.state;
        if (e.state === 'speaking') {
          this.startInterruptWatch();
        } else if (prevState === 'speaking') {
          // left speaking state — stop watching
          this.stopInterruptWatch();
        }
      }),

      // VAD-based barge-in: speech_start while speaking = interrupt
      this.bus.on('vad_state', (e) => {
        if (e.state === 'speech_start' && this.conversationState === 'speaking') {
          this.triggerInterrupt('barge_in');
        }
      })
    );
  }

  stop(): void {
    this.stopInterruptWatch();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  /**
   * Manually trigger an interrupt (e.g., from a UI button).
   */
  triggerInterrupt(source: 'barge_in' | 'manual' | 'exit_phrase' = 'manual'): void {
    if (this.interrupting) return;
    this.interrupting = true;

    if (source === 'exit_phrase') {
      this.bus.emit({ type: 'exit', timestamp: Date.now() });
    } else {
      this.bus.emit({
        type: 'interrupt',
        source,
        timestamp: Date.now(),
      });
    }

    // Reset interrupting flag after a short cooldown
    setTimeout(() => {
      this.interrupting = false;
    }, 500);
  }

  setInterruptWords(words: string[]): void {
    this.config.interruptWords = words;
  }

  private startInterruptWatch(): void {
    if (!this.config.useWebSpeechFallback) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      this.webSpeechWatcher = new SpeechRecognition();
      this.webSpeechWatcher.continuous = true;
      this.webSpeechWatcher.interimResults = true;
      this.webSpeechWatcher.lang = 'en-US';

      this.webSpeechWatcher.onresult = (event: any) => {
        const last = event.results[event.results.length - 1];
        const phrase = last[0].transcript.toLowerCase().trim();
        if (
          this.config.interruptWords.some((w) => phrase.includes(w))
        ) {
          this.triggerInterrupt('barge_in');
        }
      };

      this.webSpeechWatcher.onerror = (e: any) => {
        if (e.error === 'no-speech') {
          try {
            this.webSpeechWatcher.start();
          } catch {}
        }
      };

      this.webSpeechWatcher.onend = () => {
        if (this.conversationState === 'speaking') {
          try {
            this.webSpeechWatcher.start();
          } catch {}
        }
      };

      this.webSpeechWatcher.start();
    } catch (e) {
      console.error('[Interrupt] Failed to start Web Speech watcher:', e);
    }
  }

  private stopInterruptWatch(): void {
    if (this.webSpeechWatcher) {
      try {
        this.webSpeechWatcher.onend = null;
        this.webSpeechWatcher.stop();
      } catch {}
      this.webSpeechWatcher = null;
    }
  }

  destroy(): void {
    this.stop();
  }
}
