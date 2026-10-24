import { useOverlayStore } from '../store/overlayStore';
import type { StreamSegment } from '../store/overlayStore';
import '../types/electron-api.d';

const speechForResponse = (markdown: string, includeDisplayNotes = true): string => {
  let text = markdown;
  let hasCode = false;
  let hasTable = false;
  let hasLink = false;

  text = text.replace(/```([^\n`]*)\n?[\s\S]*?```/g, (_block, language: string) => {
    hasCode = true;
    const kind = /python/i.test(language) ? 'Python code' : /\b(bash|sh|shell|powershell|cmd)\b/i.test(language) ? 'a command' : 'code';
    return ` I’ve put ${kind} on screen. `;
  });
  text = text.replace(/^\s*\|.*\|\s*$/gm, () => { hasTable = true; return ''; });
  text = text.replace(/!?\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi, (_match, label: string) => {
    hasLink = true;
    return label.trim() || 'link';
  });
  text = text.replace(/(?:https?:\/\/|www\.)[^\s<>)\]]+/gi, () => {
    hasLink = true;
    return '';
  });
  text = text.replace(/\b(?:[\w-]+\.)+(?:com|org|net|io|dev|app|ai|co|edu|gov)(?:\/[^\s<>)\]]*)?/gi, () => {
    hasLink = true;
    return '';
  });
  text = text.replace(/`([^`]+)`/g, () => { hasCode = true; return ''; });
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt: string) => alt ? `Image: ${alt}` : 'Image');
  text = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>+\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*|__(.*?)__/g, '$1$2')
    .replace(/\*(.*?)\*|_(.*?)_/g, '$1$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (includeDisplayNotes && hasCode && !/put (?:Python code|a command|code) on screen/i.test(text)) text += ' I’ve included the code on screen.';
  if (includeDisplayNotes && hasTable) text += ' I’ve put the table on screen.';
  if (includeDisplayNotes && hasLink) text += ' I’ve put the link on screen.';
  return text.trim() || 'I’ve put the answer on screen.';
};

const splitSpeechChunks = (text: string, maxLength = 190): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]+[”’"')\]]*|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLength && current) {
        chunks.push(current);
        current = word;
      } else current = next;
    }
    if (current && /[.!?][”’"')\]]*$/.test(sentence.trim())) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

export type EchoState =
  | 'initializing'   // Mic permission check, first 800ms
  | 'listening'      // VAD active, waiting for speech
  | 'processing'     // Speech ended, Whisper running
  | 'thinking'       // Transcript sent to backend, waiting for response
  | 'speaking'       // TTS playing, agent is talking
  | 'interrupted'    // Interrupt word detected mid-speak
  | 'error';         // Mic denied or backend unreachable

export interface EchoEngineCallbacks {
  onStateChange: (state: EchoState) => void;
  onTranscriptUpdate: (text: string) => void;
  onInterimTranscriptUpdate: (text: string) => void;
  onAgentTextUpdate: (text: string) => void;
  onStructuredEvent: (event: StreamSegment) => void;
  onAmplitudeUpdate: (amplitude: number) => void;
  /** Fired when a chunk of text starts being spoken by TTS.
   *  The renderer uses this to sync word highlighting with audio. */
  onTtsChunkStart: (chunkText: string) => void;
  onExit: () => void;
}

/**
 * EchoEngine — Core audio pipeline for Echo voice mode.
 *
 * Architecture:
 * 1. Mic → AnalyserNode (amplitude) + MediaRecorder (capture)
 * 2. VAD via RMS threshold → silence detection → speech end
 * 3. Live interim transcription via Web Speech API
 * 4. Whisper transcription (final) via IPC
 * 5. LLM response via IPC
 * 6. TTS streaming: sentence-boundary chunking → synthesize per chunk → gapless playback
 * 7. Interrupt detection via parallel Speech Recognition during TTS
 *
 * Key change: streamTTS now chunks the response at sentence boundaries
 * and sends each chunk to TTS immediately, rather than waiting for the
 * full response. Audio chunks are queued for gapless playback.
 */
export class EchoEngine {
  private audioCtx: AudioContext | null = null;
  public micStream: MediaStream | null = null; // public for mute access
  private analyser: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ttsAudio: HTMLAudioElement | null = null;
  private ttsAnalyser: AnalyserNode | null = null;
  private ttsCtx: AudioContext | null = null;
  private amplitudeFrame: number = 0;
  private bargeInFrame: number = 0;
  private cancelCurrentPlayback: (() => void) | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private interruptWatcher: any = null;
  private liveRecognition: any = null;
  private currentState: EchoState = 'initializing';
  private isDestroyed: boolean = false;
  private liveFinalTranscript: string = '';
  private activeEchoRequestId: string | null = null;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private conversationSessionId = `echo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  private conversationModelKey: string | null = null;

  // TTS chunk queue for gapless playback
  private ttsQueue: { blob: Blob; text: string }[] = [];
  private ttsPlaying: boolean = false;
  private ttsCancelled: boolean = false;
  private currentTtsUrl: string | null = null;
  private currentSystemSpeechFinish: (() => void) | null = null;

  constructor(private callbacks: EchoEngineCallbacks) {
    const originalOnStateChange = callbacks.onStateChange;
    (this as any).callbacks.onStateChange = (state: EchoState) => {
      this.currentState = state;
      originalOnStateChange(state);
    };
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async start() {
    this.callbacks.onStateChange('initializing');
    await this.delay(1200);

    try {
      await this.initMic();
      this.startListening();
    } catch (e) {
      console.error('Mic initialization failed', e);
      this.callbacks.onAgentTextUpdate('Microphone access required');
      this.callbacks.onStateChange('error');
    }
  }

  destroy() {
    this.isDestroyed = true;
    this.ttsCancelled = true;
    if (this.activeEchoRequestId) {
      window.electronAPI.cancelEchoMessage(this.activeEchoRequestId);
      this.activeEchoRequestId = null;
    }
    window.speechSynthesis?.cancel();
    this.currentSystemSpeechFinish?.();
    cancelAnimationFrame(this.amplitudeFrame);
    this.stopBargeInMonitor();
    this.cancelCurrentPlayback?.();
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.ttsAudio) {
      this.ttsAudio.pause();
      this.ttsAudio.src = '';
    }
    if (this.currentTtsUrl) {
      URL.revokeObjectURL(this.currentTtsUrl);
    }
    this.ttsQueue = [];
    this.stopLiveRecognition();
    this.stopInterruptWatcher();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
    if (this.ttsCtx) {
      this.ttsCtx.close();
    }
  }

  /**
   * Public API: Send a typed text message into the Echo pipeline.
   * Bypasses STT — goes directly to the LLM agent, then TTS response.
   * Called from "Type to Echo" input in EchoMode.
   */
  /**
   * Public API: Start recording immediately (Push-to-Talk).
   * Bypasses silence detection — user holds hotkey, mic streams,
   * release triggers send. Called from EchoMode renderer.
   */
  async startPushToTalk() {
    if (this.isDestroyed || !this.micStream) return;
    // If already listening, restart fresh
    cancelAnimationFrame(this.amplitudeFrame);
    this.stopLiveRecognition();
    this.liveFinalTranscript = '';
    this.chunks = [];
    this.callbacks.onStateChange('listening');
    this.callbacks.onTranscriptUpdate('🎙 Hold to speak...');
    this.callbacks.onInterimTranscriptUpdate('');
    this.startAmplitudeLoop('mic');

    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') this.startRecorder();

    this.startLiveRecognition();
  }

  /**
   * Public API: Stop recording and immediately send (Push-to-Talk release).
   * Bypasses silence detection — user released hotkey, process and send now.
   */
  async stopPushToTalkAndSend() {
    if (this.isDestroyed) return;
    cancelAnimationFrame(this.amplitudeFrame);
    this.stopLiveRecognition();

    this.callbacks.onStateChange('processing');
    const blob = await this.stopRecorder();

    // Use live transcript if available, otherwise wait for Whisper
    if (!this.liveFinalTranscript.trim() || this.liveFinalTranscript.trim().length < 2) {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      try {
        const whisperResult = await window.electronAPI.transcribeAudio(uint8Array);
        this.liveFinalTranscript = whisperResult;
      } catch (e) {
        console.error('[EchoEngine] Push-to-talk transcription error:', e);
        this.reportTranscriptionError();
        return;
      }
    }

    const transcript = this.liveFinalTranscript.trim();
    if (!transcript || transcript.length < 2) {
      this.callbacks.onTranscriptUpdate('');
      this.callbacks.onStateChange('listening');
      this.startListening();
      return;
    }

    const lower = transcript.toLowerCase();
    if (this.isExitPhrase(lower)) {
      this.callbacks.onExit();
      return;
    }

    // Screen context check
    let agentText = transcript;
    if (this.isScreenContextPhrase(lower)) {
      try {
        const screenshot = await window.electronAPI.captureScreenshot();
        if (screenshot?.path) {
          agentText = `<file name="${screenshot.name}" path="${screenshot.path}" type="image">[Screenshot captured]</file>\n\n${transcript}`;
          this.callbacks.onTranscriptUpdate('📸 Capturing screen...');
        }
      } catch (e) {
        console.warn('[EchoEngine] Screenshot capture failed:', e);
      }
    }

    this.callbacks.onTranscriptUpdate(transcript);
    this.callbacks.onStateChange('thinking');
    await this.sendToAgent(agentText);
  }

  async sendTextMessage(text: string) {
    if (this.isDestroyed || !text.trim()) return;

    // Stop listening while processing the text message
    cancelAnimationFrame(this.amplitudeFrame);
    this.stopLiveRecognition();
    this.callbacks.onStateChange('processing');
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') await this.stopRecorder();

    // Check for exit phrase
    if (this.isExitPhrase(text.toLowerCase())) {
      this.callbacks.onExit();
      return;
    }

    // Screen context: capture screenshot and prepend to agent prompt
    let agentText = text;
    if (this.isScreenContextPhrase(text.toLowerCase())) {
      try {
        const screenshot = await window.electronAPI.captureScreenshot();
        if (screenshot?.path) {
          agentText = `<file name="${screenshot.name}" path="${screenshot.path}" type="image">[Screenshot captured]</file>\n\n${text}`;
          this.callbacks.onTranscriptUpdate('📸 Capturing screen...');
        }
      } catch (e) {
        console.warn('[EchoEngine] Screenshot capture failed:', e);
      }
    }

    // Set transcript and transition to thinking
    this.callbacks.onTranscriptUpdate(text);
    this.callbacks.onStateChange('thinking');
    await this.sendToAgent(agentText);
  }

  private async initMic() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: { ideal: 1 }, sampleRate: { ideal: 16000 } }
    });
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    
    const source = this.audioCtx.createMediaStreamSource(this.micStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
  }

  private startListening() {
    if (this.isDestroyed || !this.micStream) return;
    this.stopBargeInMonitor();
    this.liveFinalTranscript = '';
    this.callbacks.onStateChange('listening');
    this.callbacks.onTranscriptUpdate('');
    this.startRecorder();

    this.startLiveRecognition();
    this.watchForSpeech();
  }

  private startRecorder() {
    if (!this.micStream || this.isDestroyed) return;
    const formats = ['audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = formats.find(format => MediaRecorder.isTypeSupported(format));
    const recorder = new MediaRecorder(this.micStream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    recorder.ondataavailable = event => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = event => console.error('[EchoEngine] Microphone recorder failed:', event);
    recorder.start(200);
    this.mediaRecorder = recorder;
  }

  private stopRecorder(): Promise<Blob> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.resolve(new Blob(this.chunks, { type: recorder?.mimeType || 'audio/webm' }));
    }
    return new Promise(resolve => {
      const finish = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
      recorder.addEventListener('stop', finish, { once: true });
      try { recorder.stop(); } catch { finish(); }
    });
  }

  /** Live Web Speech API recognition for interim (streaming) transcript display */
  private startLiveRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        if (this.currentState !== 'listening') return;

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        // Show final text (once committed) in the main transcript
        if (finalTranscript) {
          this.liveFinalTranscript = finalTranscript.trim();
          this.callbacks.onTranscriptUpdate(this.liveFinalTranscript);
          this.callbacks.onInterimTranscriptUpdate(''); // clear interim when final arrives
        }
        // Show interim (partial) text separately for live streaming display
        if (interimTranscript) {
          this.callbacks.onInterimTranscriptUpdate(interimTranscript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('[EchoEngine] Live recognition error:', event.error);
        }
      };

      recognition.onend = () => {
        if (this.currentState === 'listening' && this.liveRecognition) {
          try { recognition.start(); } catch (_) {}
        }
      };

      // Web Speech API detects end-of-speech internally — use it
      // to trigger onSpeechEnd faster than the VAD silence timer.
      // The VAD timer (800ms) acts as a fallback if this doesn't fire.
      recognition.onspeechend = () => {
        if (this.currentState === 'listening') {
          // Small delay to let any trailing final result arrive
          setTimeout(() => {
            if (this.currentState === 'listening') {
              this.onSpeechEnd();
            }
          }, 50);
        }
      };

      this.liveRecognition = recognition;
      recognition.start();
    } catch (e) {
      console.warn('[EchoEngine] Could not start live recognition:', e);
    }
  }

  private stopLiveRecognition() {
    if (this.liveRecognition) {
      try {
        this.liveRecognition.onend = null;
        this.liveRecognition.stop();
      } catch (_) {}
      this.liveRecognition = null;
    }
  }

  private watchForSpeech() {
    const dataArray = new Uint8Array(this.analyser!.frequencyBinCount);
    const SPEECH_THRESHOLD = 0.028;
    const SILENCE_DURATION_MS = 800;
    let speechStarted = false;

    const check = () => {
      if (this.isDestroyed) return;
      this.analyser!.getByteTimeDomainData(dataArray);
      const rms = this.computeRMS(dataArray);
      this.callbacks.onAmplitudeUpdate(rms);

      if (rms > SPEECH_THRESHOLD && !speechStarted) {
        speechStarted = true;
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
      }

      if (speechStarted && rms < SPEECH_THRESHOLD) {
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this.onSpeechEnd();
          }, SILENCE_DURATION_MS);
        }
      } else if (rms > SPEECH_THRESHOLD && this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      this.amplitudeFrame = requestAnimationFrame(check);
    };

    this.amplitudeFrame = requestAnimationFrame(check);
  }

  private async onSpeechEnd() {
    if (this.isDestroyed || this.currentState !== 'listening') return;
    cancelAnimationFrame(this.amplitudeFrame);
    this.stopLiveRecognition();
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;

    this.callbacks.onStateChange('processing');
    const blob = await this.stopRecorder();

    // If we already have a transcript from Web Speech API, skip the delay
    // and use it immediately
    if (!this.liveFinalTranscript.trim() || this.liveFinalTranscript.trim().length < 2) {
      // No live transcript — wait for mediaRecorder to finalize the buffer
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      try {
        const whisperResult = await window.electronAPI.transcribeAudio(uint8Array);
        this.liveFinalTranscript = whisperResult;
      } catch (e) {
        console.error('Transcription error', e);
        this.reportTranscriptionError();
        return;
      }
    }

    let transcript = this.liveFinalTranscript.trim();

    if (!transcript || transcript.trim().length < 2) {
      this.startListening();
      return;
    }

    const lower = transcript.toLowerCase();
    if (this.isExitPhrase(lower)) {
      this.callbacks.onExit();
      return;
    }

    // Screen context: capture screenshot and prepend to agent prompt
    if (this.isScreenContextPhrase(lower)) {
      try {
        const screenshot = await window.electronAPI.captureScreenshot();
        if (screenshot?.path) {
          transcript = `<file name="${screenshot.name}" path="${screenshot.path}" type="image">[Screenshot captured]</file>\n\n${transcript}`;
          this.callbacks.onTranscriptUpdate('📸 Capturing screen...');
        }
      } catch (e) {
        console.warn('[EchoEngine] Screenshot capture failed:', e);
      }
    }

    this.callbacks.onTranscriptUpdate(transcript);
    this.callbacks.onStateChange('thinking');
    await this.sendToAgent(transcript);
  }

  private isExitPhrase(phrase: string) {
    const { echoExitWords } = useOverlayStore.getState() as any;
    const words = echoExitWords || ['goodbye', 'close', 'exit', 'stop reading'];
    return words.some((w: string) => phrase.includes(w));
  }

  private reportTranscriptionError() {
    this.callbacks.onAgentTextUpdate('Speech recognition failed. Check your microphone and try again.');
    this.callbacks.onStateChange('error');
    window.setTimeout(() => {
      if (!this.isDestroyed && this.currentState === 'error') this.startListening();
    }, 2500);
  }

  /** Check for screen-context voice commands ("what am I looking at", "see my screen"). */
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
    return triggers.some(t => phrase.includes(t));
  }

  private async sendToAgent(text: string) {
    if (this.isDestroyed) return;
    this.callbacks.onAgentTextUpdate('');

    const requestId = `echo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.activeEchoRequestId = requestId;
    const userText = text.replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, '').trim() || text;
    const priorTurns = this.conversationHistory.slice(-8).map(turn => ({
      ...turn,
      content: turn.content.length > 2400 ? `${turn.content.slice(0, 2400)}…` : turn.content,
    }));
    let prompt = priorTurns.length
      ? `Continue this voice conversation using its history.\n\n${priorTurns.map(turn => `${turn.role === 'user' ? 'User' : 'Hermes'}: ${turn.content}`).join('\n\n')}\n\nUser: ${userText}`
      : userText;

    try {
      console.log('[EchoEngine] Sending voice turn to Hermes');
      this.callbacks.onStateChange('thinking');
      
      this.ttsCancelled = false;
      this.ttsQueue = [];
      this.startInterruptWatcher();

      const voice = useOverlayStore.getState().echoTtsVoice;
      const provider = useOverlayStore.getState().echoTtsProvider;
      const state = useOverlayStore.getState();
      const modelKey = `${state.activeProvider || ''}\u0000${state.activeModel || ''}`;
      const modelChanged = this.conversationModelKey !== null && this.conversationModelKey !== modelKey;
      if (modelChanged) {
        this.conversationSessionId = `echo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      this.conversationModelKey = modelKey;
      if (!modelChanged) prompt = userText;

      // Extract screenshot path from XML-wrapped text if present
      let imagePath: string | undefined;
      const fileMatch = text.match(/<file name="([^"]+)" path="([^"]+)" type="image">/);
      if (fileMatch) {
        imagePath = fileMatch[2];
      }

      let fullResponse = '';
      let narrationScannedLength = 0;
      let narrationSpeechBuffer = '';
      let narrationTimer: ReturnType<typeof setTimeout> | null = null;
      type EchoSpeechJob = {
        text: string;
        audio: Promise<number[]>;
        stream: boolean;
        streamId?: string;
        chunks: Uint8Array[];
        complete: boolean;
        synthesisStarted: boolean;
        notify?: () => void;
      };
      const speechJobs: EchoSpeechJob[] = [];
      const activeSpeechStreams = new Map<string, EchoSpeechJob>();
      const pendingSpeechSynthesis: EchoSpeechJob[] = [];
      let activeSpeechSynthesisCount = 0;
      let speechStreamIndex = 0;
      let nextSpeechJob = 0;
      let streamFinished = false;
      let wakeSpeechPlayer: (() => void) | null = null;
      const isCurrentTurn = () => !this.isDestroyed
        && !this.ttsCancelled
        && this.activeEchoRequestId === requestId;

      const startQueuedSpeechSynthesis = () => {
        while (activeSpeechSynthesisCount < 2 && pendingSpeechSynthesis.length) {
          const job = pendingSpeechSynthesis.shift()!;
          if (!job.streamId || job.synthesisStarted || !isCurrentTurn()) continue;
          job.synthesisStarted = true;
          activeSpeechSynthesisCount++;
          void window.electronAPI.synthesizeSpeech({
            text: job.text, voice, provider, requestId, streamId: job.streamId, stream: true,
          }).catch(error => {
            console.warn('[EchoEngine] TTS stream request failed:', error);
            job.complete = true;
            job.notify?.();
          }).finally(() => {
            activeSpeechSynthesisCount--;
            startQueuedSpeechSynthesis();
          });
        }
      };

      const queueSpeech = (text: string) => {
        const clean = text.trim();
        if (!clean || !isCurrentTurn()) return;
        const stream = provider !== 'system'
          && typeof MediaSource !== 'undefined'
          && MediaSource.isTypeSupported('audio/mpeg');
        const job: EchoSpeechJob = {
          text: clean,
          audio: Promise.resolve([] as number[]),
          stream,
          chunks: [],
          complete: false,
          synthesisStarted: false,
        };
        if (stream) {
          job.streamId = `${requestId}-tts-${++speechStreamIndex}`;
          activeSpeechStreams.set(job.streamId, job);
          // Keep one segment ahead during playback without opening an
          // unbounded number of concurrent provider requests on long answers.
          pendingSpeechSynthesis.push(job);
          startQueuedSpeechSynthesis();
        } else if (provider !== 'system') {
          job.audio = window.electronAPI.synthesizeSpeech({ text: clean, voice, provider, requestId })
            .then(audio => Array.isArray(audio) ? audio : [])
            .catch(error => {
              console.warn('[EchoEngine] Hermes TTS failed; using system speech:', error);
              return [] as number[];
            });
        }
        speechJobs.push(job);
        (wakeSpeechPlayer as (() => void) | null)?.();
      };

      const unsubscribeTtsAudio = window.electronAPI.onEchoTtsAudio(event => {
        if (event.requestId !== requestId) return;
        const job = activeSpeechStreams.get(event.streamId);
        if (!job) return;
        job.chunks.push(event.chunk instanceof Uint8Array ? event.chunk : new Uint8Array(event.chunk));
        job.notify?.();
      });
      const unsubscribeTtsComplete = window.electronAPI.onEchoTtsComplete(event => {
        if (event.requestId !== requestId) return;
        const job = activeSpeechStreams.get(event.streamId);
        if (!job) return;
        if (event.error) console.warn('[EchoEngine] TTS stream ended with an error:', event.error);
        job.complete = true;
        job.notify?.();
      });

      const flushSpeechBuffer = () => {
        if (narrationTimer) clearTimeout(narrationTimer);
        narrationTimer = null;
        if (narrationSpeechBuffer.trim()) queueSpeech(narrationSpeechBuffer);
        narrationSpeechBuffer = '';
      };

      const addStableNarration = (narration: string, final = false) => {
        if (narration.length < narrationScannedLength || !narration.startsWith(fullResponseNarrationPrefix)) {
          // Markdown cleanup can temporarily alter a suffix as a link or code
          // span arrives. Keep already queued speech stable and rescan only
          // from the previous stable boundary.
          narrationScannedLength = Math.min(narrationScannedLength, narration.length);
        }
        const fresh = narration.slice(narrationScannedLength);
        narrationScannedLength = narration.length;
        fullResponseNarrationPrefix = narration;
        narrationSpeechBuffer += fresh;
        if (narrationSpeechBuffer.length >= 420) flushSpeechBuffer();
        else if (narrationSpeechBuffer.trim() && !narrationTimer && !final) {
          narrationTimer = setTimeout(flushSpeechBuffer, provider === 'system' ? 120 : 350);
        }
        if (final) flushSpeechBuffer();
      };

      let fullResponseNarrationPrefix = '';

      const playStreamingSpeech = (async () => {
        while (isCurrentTurn()) {
          if (nextSpeechJob < speechJobs.length) {
            const job = speechJobs[nextSpeechJob++];
            const audioArray = await job.audio;
            if (!isCurrentTurn()) return;
            if (job.stream) {
              const played = await this.playStreamingChunk(job);
              if (job.streamId) activeSpeechStreams.delete(job.streamId);
              if (!played && isCurrentTurn()) await this.speakWithSystemVoice(job.text, voice);
              continue;
            }
            this.callbacks.onStateChange('speaking');
            this.callbacks.onTtsChunkStart(job.text);
            if (audioArray.length) {
              const blob = new Blob([new Uint8Array(audioArray).buffer], { type: 'audio/mpeg' });
              const played = await this.playChunk(blob, job.text);
              if (!played && isCurrentTurn()) await this.speakWithSystemVoice(job.text, voice);
            } else {
              await this.speakWithSystemVoice(job.text, voice);
            }
            continue;
          }
          if (streamFinished) return;
          await new Promise<void>(resolve => { wakeSpeechPlayer = resolve; });
          wakeSpeechPlayer = null;
        }
      })();


      const unsubscribeText = window.electronAPI.onEchoStreamChunk((event) => {
        if (!isCurrentTurn() || event.requestId !== requestId) return;
        fullResponse += event.chunk;
        this.callbacks.onAgentTextUpdate(fullResponse);
        // Speak completed sentences as Hermes streams them. Keep unfinished
        // code fences out of narration and leave URLs in the visual answer.
        const fenceStarts = [...fullResponse.matchAll(/^\s*```/gm)];
        const completeMarkdown = fenceStarts.length % 2 === 1
          ? fullResponse.slice(0, fenceStarts[fenceStarts.length - 1].index)
          : fullResponse;
        const liveNarration = speechForResponse(completeMarkdown, false);
        const sentenceEnd = /[.!?](?:["')\]]*)\s+/g;
        let stableEnd = 0;
        for (const match of liveNarration.matchAll(sentenceEnd)) stableEnd = (match.index ?? 0) + match[0].length;
        addStableNarration(liveNarration.slice(0, stableEnd));
      });
      const unsubscribeEvents = window.electronAPI.onEchoStreamEvent((event) => {
        if (!isCurrentTurn() || event.requestId !== requestId) return;
        this.callbacks.onStructuredEvent(event.event);
      });

      try {
        await window.electronAPI.echoSendMessage({
          text: prompt,
          freshText: userText,
          imagePath,
          requestId,
          sessionId: this.conversationSessionId,
        });
      } catch (error) {
        streamFinished = true;
        (wakeSpeechPlayer as (() => void) | null)?.();
        await playStreamingSpeech;
        throw error;
      } finally {
        unsubscribeText();
        unsubscribeEvents();
        unsubscribeTtsAudio();
        unsubscribeTtsComplete();
        activeSpeechStreams.clear();
      }

      if (!isCurrentTurn()) return;

      // Flush any final sentence and short code/table/link notes, then finish
      // playback only after both Hermes and the audio queue have completed.
      addStableNarration(speechForResponse(fullResponse), true);
      streamFinished = true;
      (wakeSpeechPlayer as (() => void) | null)?.();
      await playStreamingSpeech;

      if (!isCurrentTurn()) return;
      this.stopInterruptWatcher();
      this.conversationHistory.push({ role: 'user', content: userText.slice(0, 2400) });
      if (fullResponse.trim()) this.conversationHistory.push({ role: 'assistant', content: fullResponse.trim().slice(-2400) });
      this.conversationHistory = this.conversationHistory.slice(-8);
      this.activeEchoRequestId = null;
      this.callbacks.onAmplitudeUpdate(0);
      this.startListening();

    } catch (e: any) {
      if (this.activeEchoRequestId !== requestId || this.isDestroyed || this.ttsCancelled) return;
      this.activeEchoRequestId = null;
      console.error('[EchoEngine] Agent communication error:', e?.message || e);
      this.callbacks.onAgentTextUpdate(`Hermes couldn’t complete that turn: ${e?.message || 'Check your provider connection.'}`);
      this.callbacks.onStateChange('error');
      window.setTimeout(() => {
        if (!this.isDestroyed && this.currentState === 'error') this.startListening();
      }, 2500);
    }
  }

  private speakWithSystemVoice(text: string, voiceName?: string): Promise<void> {
    if (this.ttsCancelled || this.isDestroyed) return Promise.resolve();
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return Promise.reject(new Error('System speech is unavailable.'));
    }
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(text);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.currentSystemSpeechFinish === finish) this.currentSystemSpeechFinish = null;
        resolve();
      };
      this.currentSystemSpeechFinish = finish;
      const voices = window.speechSynthesis.getVoices();
      const naturalVoice = voices.find(candidate => /natural|online|neural/i.test(candidate.name))
        ?? voices.find(candidate => /aria|jenny|ava|sara|guy|sonia/i.test(candidate.name));
      const voice = voices.find(candidate => candidate.name === voiceName || candidate.voiceURI === voiceName)
        ?? naturalVoice;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.onend = finish;
      utterance.onerror = event => {
        console.warn('[EchoEngine] System speech fallback failed:', event.error);
        finish();
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  /** Begin playing neural TTS as soon as the first MP3 frames arrive. */
  private playStreamingChunk(
    job: { text: string; streamId?: string; chunks: Uint8Array[]; complete: boolean; notify?: () => void },
  ): Promise<boolean> {
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg') || !job.streamId) {
      return Promise.resolve(false);
    }

    return new Promise(resolve => {
      const { text, streamId } = job;
      const mediaSource = new MediaSource();
      const audio = new Audio();
      const url = URL.createObjectURL(mediaSource);
      audio.src = url;
      audio.preload = 'auto';
      this.ttsAudio = audio;
      this.currentTtsUrl = url;

      let sourceBuffer: SourceBuffer | null = null;
      let settled = false;
      let started = false;
      let streamEnded = job.complete;

      const cleanup = (played: boolean) => {
        if (settled) return;
        settled = true;
        job.notify = undefined;
        this.stopBargeInMonitor();
        if (this.cancelCurrentPlayback === cancel) this.cancelCurrentPlayback = null;
        if (this.currentTtsUrl === url) this.currentTtsUrl = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
        this.callbacks.onAmplitudeUpdate(0);
        resolve(played);
      };

      const pump = () => {
        if (settled || !sourceBuffer || sourceBuffer.updating || mediaSource.readyState !== 'open') return;
        if (job.chunks.length) {
          try {
            sourceBuffer.appendBuffer(job.chunks.shift()!);
          } catch (error) {
            console.warn('[EchoEngine] Could not append streamed TTS audio:', error);
            cleanup(started);
          }
          return;
        }
        if (streamEnded || job.complete) {
          if (!started) cleanup(false);
          else {
            try { mediaSource.endOfStream(); } catch { /* already ended */ }
          }
        }
      };

      const playBufferedAudio = () => {
        if (settled || started || !sourceBuffer?.buffered.length) return;
        started = true;
        this.callbacks.onStateChange('speaking');
        this.callbacks.onTtsChunkStart(text);
        try {
          if (!this.ttsCtx || this.ttsCtx.state === 'closed') this.ttsCtx = new AudioContext();
          const source = this.ttsCtx.createMediaElementSource(audio);
          this.ttsAnalyser = this.ttsCtx.createAnalyser();
          this.ttsAnalyser.fftSize = 256;
          source.connect(this.ttsAnalyser);
          source.connect(this.ttsCtx.destination);
          if (this.ttsCtx.state === 'suspended') void this.ttsCtx.resume();
          this.startAmplitudeLoop('speaker');
        } catch (error) {
          console.warn('[EchoEngine] Could not monitor streamed TTS audio:', error);
        }
        this.startBargeInMonitor();
        void audio.play().catch(error => {
          console.warn('[EchoEngine] Streamed TTS playback failed:', error);
          cleanup(false);
        });
      };

      const cancel = () => {
        try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch { /* stream closed */ }
        cleanup(false);
      };
      this.cancelCurrentPlayback = cancel;
      audio.onended = () => cleanup(true);
      audio.onerror = () => cleanup(false);
      job.notify = () => {
        streamEnded = job.complete;
        pump();
      };

      mediaSource.addEventListener('sourceopen', () => {
        if (settled) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
          sourceBuffer.mode = 'sequence';
          sourceBuffer.addEventListener('updateend', () => {
            playBufferedAudio();
            pump();
          });
          pump();
          pump();
        } catch (error) {
          console.warn('[EchoEngine] Could not open streamed TTS audio:', error);
          cleanup(false);
        }
      }, { once: true });
    });
  }

  /**
   * Play a single audio chunk and wait for it to complete.
   */
  private playChunk(blob: Blob, _text: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ttsCancelled || this.isDestroyed) {
        resolve(false);
        return;
      }

      const url = URL.createObjectURL(blob);
      this.currentTtsUrl = url;
      const audio = new Audio(url);
      this.ttsAudio = audio;
      let settled = false;
      let resumePromise: Promise<void> = Promise.resolve();
      const finish = (played: boolean) => {
        if (settled) return;
        settled = true;
        this.stopBargeInMonitor();
        if (this.cancelCurrentPlayback === cancel) this.cancelCurrentPlayback = null;
        if (this.currentTtsUrl === url) this.currentTtsUrl = null;
        URL.revokeObjectURL(url);
        this.callbacks.onAmplitudeUpdate(0);
        resolve(played);
      };
      const cancel = () => {
        audio.pause();
        finish(false);
      };
      this.cancelCurrentPlayback = cancel;

      try {
        if (!this.ttsCtx || this.ttsCtx.state === 'closed') this.ttsCtx = new AudioContext();
        if (this.ttsCtx.state === 'suspended') resumePromise = this.ttsCtx.resume();
        const ttsSource = this.ttsCtx.createMediaElementSource(audio);
        this.ttsAnalyser = this.ttsCtx.createAnalyser();
        this.ttsAnalyser.fftSize = 256;
        ttsSource.connect(this.ttsAnalyser);
        ttsSource.connect(this.ttsCtx.destination);
        this.startAmplitudeLoop('speaker');
      } catch (error) {
        console.warn('[EchoEngine] Could not set up TTS analyser:', error);
      }

      this.startBargeInMonitor();
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      void resumePromise.then(() => audio.play()).catch(() => finish(false));
    });
  }

  private startInterruptWatcher() {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    try {
      this.interruptWatcher = new SpeechRecognition();
      this.interruptWatcher.continuous = true;
      this.interruptWatcher.interimResults = true;
      this.interruptWatcher.lang = 'en-US';

      this.interruptWatcher.onresult = (event: any) => {
        const last = event.results[event.results.length - 1];
        const phrase = last[0].transcript.toLowerCase().trim();

        const { echoInterruptWords } = useOverlayStore.getState() as any;
        const words = echoInterruptWords || ['stop', 'wait', 'shut up', 'hey hermes'];
        const isInterrupt = words.some((w: string) => phrase.includes(w));

        if (isInterrupt) {
          this.interrupt();
        }
      };

      this.interruptWatcher.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('[EchoEngine] Interruption recognition error:', event.error);
        }
      };

      const watcher = this.interruptWatcher;
      watcher.onend = () => {
        const responseActive = this.activeEchoRequestId
          && (this.currentState === 'thinking' || this.currentState === 'speaking');
        if (responseActive && this.interruptWatcher === watcher) {
          window.setTimeout(() => {
            if (this.interruptWatcher === watcher && this.activeEchoRequestId
              && (this.currentState === 'thinking' || this.currentState === 'speaking')) {
              try { watcher.start(); } catch (_) {}
            }
          }, 100);
        }
      };

      this.interruptWatcher.start();
    } catch (e) {
      console.error('Failed to start interrupt watcher', e);
    }
  }

  interrupt() {
    // Cancel TTS immediately — no fade
    this.ttsCancelled = true;
    const requestId = this.activeEchoRequestId;
    this.activeEchoRequestId = null;
    if (requestId) window.electronAPI.cancelEchoMessage(requestId);
    window.speechSynthesis?.cancel();
    this.currentSystemSpeechFinish?.();
    this.stopBargeInMonitor();
    this.cancelCurrentPlayback?.();
    if (this.ttsAudio) {
      this.ttsAudio.pause();
      this.ttsAudio.currentTime = 0;
    }
    if (this.currentTtsUrl) {
      URL.revokeObjectURL(this.currentTtsUrl);
      this.currentTtsUrl = null;
    }
    this.ttsQueue = [];

    this.stopInterruptWatcher();
    this.callbacks.onStateChange('interrupted');
    this.callbacks.onAmplitudeUpdate(0);

    setTimeout(() => {
      if (!this.isDestroyed) {
        this.startListening();
      }
    }, 400);
  }

  private startBargeInMonitor() {
    this.stopBargeInMonitor();
    if (!this.analyser || !this.micStream?.getAudioTracks().some(track => track.enabled)) return;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    let speechStartedAt = 0;
    const check = () => {
      if (this.isDestroyed || this.currentState !== 'speaking' || !this.activeEchoRequestId) {
        this.bargeInFrame = 0;
        return;
      }
      this.analyser!.getByteTimeDomainData(dataArray);
      const level = this.computeRMS(dataArray);
      const now = performance.now();
      if (level >= 0.028) {
        if (!speechStartedAt) speechStartedAt = now;
        if (now - speechStartedAt >= 260) {
          this.interrupt();
          return;
        }
      } else {
        speechStartedAt = 0;
      }
      this.bargeInFrame = requestAnimationFrame(check);
    };
    this.bargeInFrame = requestAnimationFrame(check);
  }

  private stopBargeInMonitor() {
    if (this.bargeInFrame) cancelAnimationFrame(this.bargeInFrame);
    this.bargeInFrame = 0;
  }

  private stopInterruptWatcher() {
    if (this.interruptWatcher) {
      try {
        this.interruptWatcher.stop();
      } catch (e) {}
      this.interruptWatcher = null;
    }
  }

  private startAmplitudeLoop(source: 'mic' | 'speaker') {
    cancelAnimationFrame(this.amplitudeFrame);
    const analyser = source === 'mic' ? this.analyser : this.ttsAnalyser;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const loop = () => {
      if (this.isDestroyed) return;
      analyser.getByteTimeDomainData(dataArray);
      const rms = this.computeRMS(dataArray);
      this.callbacks.onAmplitudeUpdate(Math.min(rms * 3, 1));
      this.amplitudeFrame = requestAnimationFrame(loop);
    };
    this.amplitudeFrame = requestAnimationFrame(loop);
  }

  private computeRMS(dataArray: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const norm = (dataArray[i] - 128) / 128;
      sum += norm * norm;
    }
    return Math.sqrt(sum / dataArray.length);
  }
}
