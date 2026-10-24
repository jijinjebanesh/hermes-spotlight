import React, { useEffect, useState, useRef, useCallback } from 'react';
import { EchoEngine, EchoState } from '../audio/EchoEngine';
import { Mic, MicOff, Square, Plus, Sparkles, X } from 'lucide-react';
import { useEchoSession } from '../hooks/useEchoSession';
import { useEchoKeyboard } from '../hooks/useEchoKeyboard';
import type { EchoSessionTurn } from '../hooks/useEchoSession';
import type { ToolCompleteSegment, ToolStartSegment } from './message/toolDisplay';
import { MarkdownContent } from './message/MarkdownContent';
import { ToolActivityPill } from './message/ToolActivityPill';
import type { StreamSegment } from '../store/overlayStore';

interface EchoModeProps {
  onExit: (sessionTranscript?: EchoSessionTurn[]) => void;
  onSwitchToChat: (sessionTranscript?: EchoSessionTurn[]) => void;
}

/**
 * Apple-style live transcript display mode:
 * - "Apple Intelligence" style: agent words reveal in sync with TTS audio,
 *   using onTtsChunkStart to snap highlighting to the chunk being spoken.
 * - Bubble sits BELOW the orb, above controls — not floating way up top.
 * - Smooth vertical auto-scroll when text overflows — no horizontal jank.
 * - Listening: user transcript with dimmed interim text, single-line.
 * - Thinking/Processing: finalized transcript with soft animation.
 * - Responsive: max-height adapts to window/compact mode, font scales naturally.
 */
export const EchoMode: React.FC<EchoModeProps> = ({ onExit, onSwitchToChat }) => {
  const [state, setState] = useState<EchoState>('initializing');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [agentText, setAgentText] = useState('');
  const [lastUserText, setLastUserText] = useState('');
  const [toolSegments, setToolSegments] = useState<Array<ToolStartSegment | ToolCompleteSegment>>([]);
  const [currentSpeech, setCurrentSpeech] = useState('');
  const [amplitude, setAmplitude] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [ariaAnnouncement, setAriaAnnouncement] = useState('');
  const [latencyWarning, setLatencyWarning] = useState<string | null>(null);
  const [osMicMuted, setOsMicMuted] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInputValue, setTextInputValue] = useState('');

  // Word reveal synced to TTS chunks — onTtsChunkStart snaps these forward

  const engineRef = useRef<EchoEngine | null>(null);
  const prevStateRef = useRef<EchoState>('initializing');
  const muteBtnRef = useRef<HTMLButtonElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const wasMutedBeforeTextRef = useRef(false);
  const latencyTimerRef = useRef<{ t5: ReturnType<typeof setTimeout> | null; t15: ReturnType<typeof setTimeout> | null }>({ t5: null, t15: null });

  const { sessionDuration, getTranscript } = useEchoSession(state, transcript, agentText);

  // ── Compact mode detection ──
  useEffect(() => {
    if (state !== 'initializing' && muteBtnRef.current) {
      const t = setTimeout(() => muteBtnRef.current?.focus(), 600);
      return () => clearTimeout(t);
    }
  }, [state === 'initializing']);

  // ── ARIA announcements on state change ──
  useEffect(() => {
    if (state === prevStateRef.current) return;
    prevStateRef.current = state;
    const announcements: Record<EchoState, string> = {
      initializing: 'Echo mode starting up',
      listening: isMuted ? 'Microphone muted' : 'Hermes is listening',
      processing: 'Processing your speech',
      thinking: 'Hermes is thinking',
      speaking: 'Hermes is speaking',
      interrupted: 'Interrupted. Hermes is listening.',
      error: 'Error: Cannot access microphone',
    };
    setAriaAnnouncement(announcements[state] || '');
  }, [state, isMuted, agentText]);

  // ── Latency warning timers ──
  useEffect(() => {
    if (latencyTimerRef.current.t5) clearTimeout(latencyTimerRef.current.t5);
    if (latencyTimerRef.current.t15) clearTimeout(latencyTimerRef.current.t15);
    setLatencyWarning(null);

    if (state === 'processing' || state === 'thinking') {
      latencyTimerRef.current.t5 = setTimeout(() => {
        setLatencyWarning('Still processing…');
      }, 5000);
      latencyTimerRef.current.t15 = setTimeout(() => {
        setLatencyWarning('Transcription taking longer than expected.');
      }, 15000);
    }

    return () => {
      if (latencyTimerRef.current.t5) clearTimeout(latencyTimerRef.current.t5);
      if (latencyTimerRef.current.t15) clearTimeout(latencyTimerRef.current.t15);
    };
  }, [state]);

  // ── OS-level mic mute detection ──
  useEffect(() => {
    if (!engineRef.current?.micStream) return;
    const tracks = engineRef.current.micStream.getAudioTracks();
    const handler = () => {
      const anyMuted = tracks.some(t => t.muted);
      setOsMicMuted(anyMuted);
    };
    tracks.forEach(t => {
      t.addEventListener('mute', handler);
      t.addEventListener('unmute', handler);
    });
    return () => {
      tracks.forEach(t => {
        t.removeEventListener('mute', handler);
        t.removeEventListener('unmute', handler);
      });
    };
  }, [state]);

  // ── Keep agentTextRef in sync ──
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleExit = useCallback(() => {
    engineRef.current?.destroy();
    const transcriptTurns = getTranscript();
    onExit(transcriptTurns.length > 0 ? transcriptTurns : undefined);
  }, [onExit, getTranscript]);

  const handleSwitchToChat = useCallback(() => {
    engineRef.current?.destroy();
    const transcriptTurns = getTranscript();
    onSwitchToChat(transcriptTurns.length > 0 ? transcriptTurns : undefined);
  }, [onSwitchToChat, getTranscript]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (engineRef.current) {
        const stream = engineRef.current.micStream;
        if (stream) {
          stream.getAudioTracks().forEach(t => { t.enabled = !next; });
        }
      }
      return next;
    });
  }, []);

  const openTextInput = useCallback(() => {
    wasMutedBeforeTextRef.current = isMuted;
    if (!isMuted && engineRef.current?.micStream) {
      engineRef.current.micStream.getAudioTracks().forEach(t => { t.enabled = false; });
      setIsMuted(true);
    }
    setShowTextInput(true);
    setTextInputValue('');
    setTimeout(() => textInputRef.current?.focus(), 80);
  }, [isMuted]);

  const closeTextInput = useCallback(() => {
    setShowTextInput(false);
    setTextInputValue('');
    if (!wasMutedBeforeTextRef.current && engineRef.current?.micStream) {
      engineRef.current?.micStream.getAudioTracks().forEach(t => { t.enabled = true; });
      setIsMuted(false);
    }
  }, []);

  const submitTextInput = useCallback(() => {
    const text = textInputValue.trim();
    if (!text || !engineRef.current) return;

    setShowTextInput(false);
    setTextInputValue('');

    if (!wasMutedBeforeTextRef.current && engineRef.current?.micStream) {
      engineRef.current?.micStream.getAudioTracks().forEach(t => { t.enabled = true; });
      setIsMuted(false);
    }

    engineRef.current.sendTextMessage(text);
  }, [textInputValue]);

  // ── onTtsChunkStart: TTS just started speaking this text — sync word reveal ──
  useEffect(() => {
    const engine = new EchoEngine({
      onStateChange: setState,
      onTranscriptUpdate: (text) => {
        setTranscript(text);
        if (text.trim() && !text.includes('Capturing screen')) setLastUserText(text.trim());
        setInterimTranscript('');
      },
      onInterimTranscriptUpdate: setInterimTranscript,
      onAgentTextUpdate: (text) => {
        setAgentText(text);
        if (!text) { setToolSegments([]); setCurrentSpeech(''); }
      },
      onStructuredEvent: (event: StreamSegment) => {
        if (event.type === 'tool_start' || event.type === 'tool_complete') {
          setToolSegments(previous => [...previous, event as ToolStartSegment | ToolCompleteSegment]);
        }
      },
      onAmplitudeUpdate: setAmplitude,
      onTtsChunkStart: setCurrentSpeech,
      onExit: handleExit,
    });

    engineRef.current = engine;
    engine.start();

    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [handleExit]);

  // ── Keyboard bindings ──
  useEchoKeyboard({
    onEscape: () => state === 'thinking' || state === 'speaking'
      ? engineRef.current?.interrupt()
      : showTextInput ? closeTextInput() : handleSwitchToChat(),
    onToggleMute: toggleMute,
    onToggleTextInput: () => showTextInput ? closeTextInput() : openTextInput(),
    showTextInput,
  });

  // ── Push-to-Talk (Ctrl+Space walkie-talkie) ──
  const pushToTalkActiveRef = useRef(false);

  useEffect(() => {
    const handler = () => {
      if (!engineRef.current) return;
      if (pushToTalkActiveRef.current) {
        // Second press = release → stop recording and send
        pushToTalkActiveRef.current = false;
        engineRef.current.stopPushToTalkAndSend();
      } else {
        // First press = start recording
        pushToTalkActiveRef.current = true;
        engineRef.current.startPushToTalk();
      }
    };
    window.addEventListener('push-to-talk-toggle', handler);
    return () => window.removeEventListener('push-to-talk-toggle', handler);
  }, []);

  // ── Display logic ──

  const busy = state === 'processing' || state === 'thinking';
  const waveformActive = state === 'listening' || state === 'speaking' || state === 'interrupted';
  const completedToolIds = new Set(toolSegments.filter(segment => segment.type === 'tool_complete').map(segment => segment.toolId));
  const toolsRunning = toolSegments.some(segment => segment.type === 'tool_start' && !completedToolIds.has(segment.toolId));
  const statusText = state === 'error'
    ? (agentText || 'Microphone access required')
    : busy
      ? (latencyWarning || (toolsRunning ? 'Using tools' : 'Thinking'))
      : state === 'speaking'
        ? 'Speaking'
        : state === 'listening' && (interimTranscript || transcript)
          ? (interimTranscript || transcript)
          : 'Ask Hermes anything?';

  return (
    <div className="echo-mode-container" data-state={state} data-muted={isMuted}>
      <div role="status" aria-live="polite" className="echo-sr-status">{ariaAnnouncement}</div>
      <div className="echo-pill" role="group" aria-label="Echo live conversation">
        <button className="spotlight-orb echo-brand-mark" onClick={handleSwitchToChat} aria-label="Return to chat" title="Return to chat (Esc)">
          <Sparkles size={17} strokeWidth={1.8} />
        </button>
        <button className={`echo-add-btn${showTextInput ? ' active' : ''}`} onClick={() => showTextInput ? closeTextInput() : openTextInput()} aria-label={showTextInput ? 'Close text input' : 'Type a message'} title="Type a message (T)" disabled={busy || state === 'speaking'}>
          {showTextInput ? <X size={17} /> : <Plus size={19} />}
        </button>
        {showTextInput ? (
          <input ref={textInputRef} className="echo-pill-input" value={textInputValue} onChange={e => setTextInputValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTextInput(); } }} placeholder="Ask Hermes anything?" aria-label="Type a message to Hermes" autoComplete="off" spellCheck={false} />
        ) : busy ? (
          <div className="echo-thinking-dots" aria-label="Hermes is thinking"><i /><i /><i /></div>
        ) : waveformActive ? (
          <div className="echo-waveform" aria-label={state === 'speaking' ? 'Hermes is speaking' : isMuted ? 'Microphone muted' : 'Listening'}>
            {[8, 15, 23, 12, 19, 27, 14, 22, 10, 18, 25].map((height, index) => <i key={index} style={{ '--bar-height': `${height}px`, '--bar-delay': `${index * -70}ms`, '--bar-gain': Math.max(.18, Math.min(1, amplitude * 2.5)) } as React.CSSProperties} />)}
          </div>
        ) : (
          <span className={`echo-pill-prompt${state === 'error' ? ' error' : ''}`} title={statusText}>{statusText}</span>
        )}
        {state !== 'initializing' && state !== 'thinking' && state !== 'speaking' && <button ref={muteBtnRef} className={`echo-mic-btn${isMuted ? ' muted' : ''}`} onClick={toggleMute} aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'} title={isMuted ? 'Unmute (Space)' : `Mute (Space) · ${formatDuration(sessionDuration)}`}>
          {isMuted ? <MicOff size={16} /> : <Mic size={17} />}
        </button>}
        {(state === 'thinking' || state === 'speaking') && <button className="echo-interrupt-btn" onClick={() => engineRef.current?.interrupt()} aria-label="Interrupt response" title="Interrupt response (Esc)">
          <Square size={12} fill="currentColor" />
        </button>}
        {state !== 'initializing' && <button className={`echo-stop-btn${state === 'error' ? ' dismiss' : state === 'thinking' || state === 'speaking' ? ' secondary' : ''}`} onClick={state === 'error' ? handleSwitchToChat : handleExit} aria-label={state === 'error' ? 'Return to chat' : 'End conversation and return to chat'} title={state === 'error' ? 'Return to chat' : 'End conversation'}>
          {state === 'error' || state === 'thinking' || state === 'speaking' ? <X size={15} /> : <Square size={13} fill="currentColor" />}
        </button>}
      </div>
      {(agentText.trim() || toolSegments.length > 0) && (
        <section className="echo-response-card spotlight-answer-card" aria-label="Live voice response">
          {lastUserText && (
            <div className="echo-response-context">
              <span>You</span>
              <p>{lastUserText}</p>
            </div>
          )}
          <div className="spotlight-answer-body echo-answer-body">
            {toolSegments.length > 0 && <ToolActivityPill segments={toolSegments} compact />}
            {agentText.trim() && <MarkdownContent content={agentText} />}
            {state === 'speaking' && currentSpeech && <div className="echo-speech-caption"><span>Speaking</span><p>{currentSpeech}</p></div>}
          </div>
        </section>
      )}
      {osMicMuted && !isMuted && <span className="echo-os-muted" role="status">Microphone muted by system</span>}
    </div>
  );
};
