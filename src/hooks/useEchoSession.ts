import { useState, useRef, useEffect, useCallback } from 'react';
import { EchoState } from '../audio/EchoEngine';
export interface EchoSessionTurn {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

export const useEchoSession = (state: EchoState, transcript: string, agentText: string) => {
  const [sessionDuration, setSessionDuration] = useState(0);
  const sessionStartRef = useRef<number>(Date.now());
  const sessionTranscriptRef = useRef<EchoSessionTurn[]>([]);

  useEffect(() => {
    if (state === 'initializing' || state === 'error') return;
    sessionStartRef.current = Date.now();
    const timer = setInterval(() => {
      setSessionDuration(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [state === 'initializing']);

  useEffect(() => {
    if (state === 'thinking' && transcript.trim()) {
      const text = transcript.trim();
      const previous = sessionTranscriptRef.current.at(-1);
      if (previous?.role !== 'user' || previous.text !== text) {
        sessionTranscriptRef.current.push({ role: 'user', text, timestamp: Date.now() });
      }
    }
  }, [state, transcript]);

  useEffect(() => {
    if ((state === 'listening' || state === 'interrupted') && agentText.trim()) {
      const text = agentText.trim();
      const previous = sessionTranscriptRef.current.at(-1);
      if (previous?.role !== 'agent' || previous.text !== text) {
        sessionTranscriptRef.current.push({ role: 'agent', text, timestamp: Date.now() });
      }
    }
  }, [state, agentText]);

  const addManualUserTurn = useCallback((text: string) => {
    sessionTranscriptRef.current.push({
      role: 'user',
      text,
      timestamp: Date.now(),
    });
  }, []);

  const getTranscript = useCallback(() => sessionTranscriptRef.current, []);

  return {
    sessionDuration,
    getTranscript,
    addManualUserTurn,
  };
};
