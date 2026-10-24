/**
 * ConversationManager — Central state machine + conversation state.
 *
 * Owns the Echo Mode state lifecycle and conversation context.
 * No other module transitions Echo states — they emit events that
 * ConversationManager listens to and decides the next state.
 *
 * Responsibilities:
 * - Session lifecycle (turn tracking, context memory)
 * - State transitions (listening → processing → thinking → speaking → interrupted → listening)
 * - User interruption handling (barge-in → cancel TTS → return to listening)
 * - Idle timeout management (auto-close after configurable inactivity)
 * - Echo Mode activation (wake word / clap → enter listening)
 * - Exit phrase detection
 * - Event routing between pipeline components
 *
 * Listens to:
 *   activation     → enter listening
 *   stt_final      → transition to processing, start LLM
 *   vad_state      → speech_end triggers STT, speech_start during speaking = barge-in
 *   llm_chunk      → first chunk → speaking state
 *   playback_state → ended → back to listening
 *   interrupt      → cancel all, go to interrupted → listening
 *   exit phrase    → pipeline exit
 */

import { EventBus } from './EventBus';
import { EchoState } from './types';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const INTERRUPT_COOLDOWN_MS = 400;
const EXIT_WORDS_DEFAULT = ['goodbye', 'close', 'exit', 'stop reading'];
const SCREEN_CONTEXT_TRIGGERS = [
  'what am i looking at',
  'see my screen',
  'look at my screen',
  'screenshot',
  'capture screen',
  'what is on my screen',
  'show me my screen',
  'what do you see',
];

export interface ConversationConfig {
  exitWords?: string[];
  idleTimeoutMs?: number;
}

interface Turn {
  id: string;
  userText: string;
  agentText: string;
  timestamp: number;
  completed: boolean;
}

export class ConversationManager {
  private bus: EventBus;
  private state: EchoState = 'initializing';
  private config: Required<ConversationConfig>;
  private turns: Turn[] = [];
  private currentTurnId: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private interruptCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private unsubs: (() => void)[] = [];

  constructor(bus: EventBus, config?: ConversationConfig) {
    this.bus = bus;
    this.config = {
      exitWords: config?.exitWords ?? EXIT_WORDS_DEFAULT,
      idleTimeoutMs: config?.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
    };
  }

  /**
   * Start the conversation manager and subscribe to events.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.unsubs.push(
      this.bus.on('activation', () => this.onActivation()),
      this.bus.on('stt_final', (e) => this.onSTTFinal(e.text)),
      this.bus.on('vad_state', (e) => {
        if (e.state === 'speech_end' && this.state === 'listening') {
          // VAD detected speech end — STT provider will handle transcription
          // (The STT provider reads chunks and emits stt_final)
        }
        if (e.state === 'speech_start' && this.state === 'speaking') {
          // Barge-in: user started speaking while agent is talking
          this.bus.emit({
            type: 'interrupt',
            source: 'barge_in',
            timestamp: Date.now(),
          });
        }
      }),
      this.bus.on('llm_chunk', (e) => {
        if (e.isFinal && this.state === 'thinking') {
          // First chunk from LLM — but we transition to speaking
          // when TTS actually starts, not when text arrives
        }
      }),
      this.bus.on('playback_state', (e) => {
        if (e.state === 'playing' && this.state === 'thinking') {
          this.transition('speaking');
        }
        if (e.state === 'ended' && this.state === 'speaking') {
          this.resetIdleTimer();
          this.transition('listening');
        }
        if (e.state === 'interrupted') {
          this.handleInterrupt();
        }
      }),
      this.bus.on('interrupt', (e) => {
        this.handleInterrupt();
        if (e.source === 'exit_phrase') {
          this.bus.emit({ type: 'exit', timestamp: Date.now() });
        }
      })
    );

    this.transition('listening');
    this.resetIdleTimer();
  }

  stop(): void {
    this.running = false;
    this.cancelIdleTimer();
    this.cancelInterruptCooldown();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  getState(): EchoState {
    return this.state;
  }

  getTurns(): Turn[] {
    return this.turns;
  }

  /**
   * Reset the conversation (new session).
   */
  reset(): void {
    this.turns = [];
    this.currentTurnId = null;
    this.transition('listening');
    this.resetIdleTimer();
  }

  // ─── Event Handlers ──────────────────────────────────────────────────

  private onActivation(): void {
    if (!this.running) return;
    if (this.state === 'initializing' || this.state === 'error') {
      this.transition('listening');
    }
    this.resetIdleTimer();
  }

  private onSTTFinal(text: string): void {
    if (!this.running || !text.trim()) return;

    const lower = text.toLowerCase();

    // Check for exit phrase
    if (this.isExitPhrase(lower)) {
      this.bus.emit({ type: 'exit', timestamp: Date.now() });
      return;
    }

    // Check for screen context
    let agentText = text;
    if (this.isScreenContextPhrase(lower)) {
      // Screenshot capture will be handled by EchoEngine
      agentText = `__SCREEN_CONTEXT__${text}`;
    }

    // Create a new turn
    const turnId = this.generateTurnId();
    this.currentTurnId = turnId;
    this.turns.push({
      id: turnId,
      userText: text,
      agentText: '',
      timestamp: Date.now(),
      completed: false,
    });

    // Transition to thinking
    this.transition('thinking');
    this.bus.emit({
      type: 'transcript_update',
      text: agentText,
      timestamp: Date.now(),
    });

    // Request LLM response (the LLMStreamingService listens to this)
    // Actually — we route directly to LLM via the request event
  }

  private handleInterrupt(): void {
    this.transition('interrupted');
    this.cancelInterruptCooldown();
    this.interruptCooldownTimer = setTimeout(() => {
      if (this.running && this.state === 'interrupted') {
        this.transition('listening');
      }
    }, INTERRUPT_COOLDOWN_MS);
  }

  // ─── State Transitions ───────────────────────────────────────────────

  private transition(newState: EchoState): void {
    if (this.state === newState) return;

    // Log transition for debugging
    console.log(`[ConversationManager] ${this.state} → ${newState}`);

    this.state = newState;

    this.bus.emit({
      type: 'conversation_state',
      state: newState,
      turnId: this.currentTurnId ?? undefined,
      timestamp: Date.now(),
    });

    // Health reporting
    this.bus.emit({
      type: 'health',
      component: 'ConversationManager',
      healthy: newState !== 'error',
      message: `state=${newState}`,
      timestamp: Date.now(),
    });
  }

  // ─── Idle Timeout ────────────────────────────────────────────────────

  private resetIdleTimer(): void {
    this.cancelIdleTimer();
    if (this.config.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        console.log('[ConversationManager] Idle timeout — exiting');
        this.bus.emit({ type: 'exit', timestamp: Date.now() });
      }, this.config.idleTimeoutMs);
    }
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private cancelInterruptCooldown(): void {
    if (this.interruptCooldownTimer) {
      clearTimeout(this.interruptCooldownTimer);
      this.interruptCooldownTimer = null;
    }
  }

  // ─── Phrase Detection ────────────────────────────────────────────────

  private isExitPhrase(phrase: string): boolean {
    return this.config.exitWords.some((w) => phrase.includes(w));
  }

  private isScreenContextPhrase(phrase: string): boolean {
    return SCREEN_CONTEXT_TRIGGERS.some((t) => phrase.includes(t));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private generateTurnId(): string {
    return `turn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  destroy(): void {
    this.stop();
  }
}
