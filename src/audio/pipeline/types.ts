/**
 * Pipeline Type Definitions — Voice pipeline event types.
 *
 * All modules communicate through these typed events via the EventBus.
 * No module directly calls methods on another module.
 */

// ─── Echo State Machine ─────────────────────────────────────────────────

export type EchoState =
  | 'initializing'   // Mic permission check, first 800ms
  | 'listening'      // VAD active, waiting for speech
  | 'processing'     // Speech ended, STT running
  | 'thinking'       // Transcript sent to backend, waiting for LLM response
  | 'speaking'       // TTS playing, agent is talking
  | 'interrupted'    // Interrupt word detected mid-speak
  | 'error';         // Mic denied or backend unreachable

export type MicState =
  | 'inactive'       // Not started or stopped
  | 'requesting'     // Requesting getUserMedia permission
  | 'active'         // Stream live, capturing audio
  | 'suspended'      // Temporarily paused (tab hidden, etc.)
  | 'recovering'     // Stream lost, attempting reconnection
  | 'error';         // Unrecoverable failure (permission denied, no device)

export type VADState = 'silence' | 'speech_start' | 'speaking' | 'speech_end';

// ─── Event Types ────────────────────────────────────────────────────────

export interface MicrophoneStateEvent {
  type: 'mic_state';
  state: MicState;
  error?: string;
  timestamp: number;
}

export interface AudioChunkEvent {
  type: 'audio_chunk';
  /** PCM float32 samples, mono, at the configured sample rate */
  samples: Float32Array;
  /** Sample rate of the audio (e.g., 16000) */
  sampleRate: number;
  /** Millisecond offset from pipeline start */
  timestamp: number;
}

export interface MicAmplitudeEvent {
  type: 'amplitude';
  /** RMS amplitude 0..1 from the mic input */
  value: number;
  timestamp: number;
}

export interface TtsAmplitudeEvent {
  type: 'tts_amplitude';
  /** RMS amplitude 0..1 from the TTS output */
  value: number;
  timestamp: number;
}

export interface VadStateEvent {
  type: 'vad_state';
  state: VADState;
  timestamp: number;
}

export interface ActivationEvent {
  type: 'activation';
  /** What triggered the activation */
  source: 'wake_word' | 'double_clap' | 'hotkey' | 'push_to_talk' | 'manual';
  /** Detected phrase (for wake word) or gap in ms (for clap) */
  detail?: string;
  timestamp: number;
}

export interface STTPartialEvent {
  type: 'stt_partial';
  /** Partial (interim) transcript while user is still speaking */
  text: string;
  timestamp: number;
}

export interface STTFinalEvent {
  type: 'stt_final';
  /** Final transcript after speech has ended */
  text: string;
  confidence?: number;
  timestamp: number;
}

export interface ConversationStateEvent {
  type: 'conversation_state';
  state: EchoState;
  /** Unique turn ID for this conversation exchange */
  turnId?: string;
  timestamp: number;
}

export interface LLMChunkEvent {
  type: 'llm_chunk';
  /** Incremental text chunk from the LLM stream */
  text: string;
  /** Whether this is the final chunk of the response */
  isFinal: boolean;
  timestamp: number;
}

export interface TTSChunkEvent {
  type: 'tts_chunk';
  /** Audio blob ready for playback */
  blob: Blob;
  /** Text that was synthesized (for word highlighting) */
  text: string;
  /** Chunk index for ordering */
  index: number;
  timestamp: number;
}

export interface PlaybackStateEvent {
  type: 'playback_state';
  state: 'playing' | 'ended' | 'interrupted' | 'idle';
  timestamp: number;
}

export interface InterruptEvent {
  type: 'interrupt';
  /** What caused the interrupt */
  source: 'barge_in' | 'manual' | 'exit_phrase';
  timestamp: number;
}

export interface STTChunkReadyEvent {
  type: 'tts_chunk_start';
  /** Text that is about to be spoken (for renderer word highlighting) */
  text: string;
  index: number;
  timestamp: number;
}

export interface PipelineControlEvent {
  type: 'pipeline_start' | 'pipeline_stop' | 'pipeline_reset';
  timestamp: number;
}

export interface HealthEvent {
  type: 'health';
  /** Which component is reporting */
  component: string;
  healthy: boolean;
  message?: string;
  timestamp: number;
}

export interface ErrorEvent {
  type: 'pipeline_error';
  /** Which module caused the error */
  source: string;
  message: string;
  /** 'recoverable' = retry, 'fatal' = stop pipeline */
  severity: 'recoverable' | 'fatal';
  timestamp: number;
}

export interface TranscriptUpdateEvent {
  type: 'transcript_update';
  text: string;
  timestamp: number;
}

export interface ExitEvent {
  type: 'exit';
  timestamp: number;
}

// ─── Event Union ────────────────────────────────────────────────────────

export type PipelineEvent =
  | MicrophoneStateEvent
  | AudioChunkEvent
  | MicAmplitudeEvent
  | TtsAmplitudeEvent
  | VadStateEvent
  | ActivationEvent
  | STTPartialEvent
  | STTFinalEvent
  | ConversationStateEvent
  | LLMChunkEvent
  | TTSChunkEvent
  | PlaybackStateEvent
  | InterruptEvent
  | STTChunkReadyEvent
  | PipelineControlEvent
  | HealthEvent
  | ErrorEvent
  | TranscriptUpdateEvent
  | ExitEvent;

// ─── Helper: Event Type Strings ──────────────────────────────────────────

export type EventTarget = AudioChunkEvent | AudioChunkEvent;

/** Extract the string literal type from a PipelineEvent's `type` field */
export type EventTypeOf<E extends PipelineEvent> = E['type'];

/** Map from event type string to the corresponding event interface */
export interface EventMap {
  'mic_state': MicrophoneStateEvent;
  'audio_chunk': AudioChunkEvent;
  'amplitude': MicAmplitudeEvent;
  'tts_amplitude': TtsAmplitudeEvent;
  'vad_state': VadStateEvent;
  'activation': ActivationEvent;
  'stt_partial': STTPartialEvent;
  'stt_final': STTFinalEvent;
  'conversation_state': ConversationStateEvent;
  'llm_chunk': LLMChunkEvent;
  'tts_chunk': TTSChunkEvent;
  'playback_state': PlaybackStateEvent;
  'interrupt': InterruptEvent;
  'tts_chunk_start': STTChunkReadyEvent;
  'pipeline_start': PipelineControlEvent;
  'pipeline_stop': PipelineControlEvent;
  'pipeline_reset': PipelineControlEvent;
  'health': HealthEvent;
  'pipeline_error': ErrorEvent;
  'transcript_update': TranscriptUpdateEvent;
  'exit': ExitEvent;
}

export type EventTopic = keyof EventMap;
