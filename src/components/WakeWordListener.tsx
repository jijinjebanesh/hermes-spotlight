import React, { useEffect, useRef, useCallback } from 'react';
import { useOverlayStore } from '../store/overlayStore';

/**
 * Headless component that listens continuously for the wake word
 * using the Web Speech API (webkitSpeechRecognition).
 *
 * Uses short non-continuous sessions that restart themselves to work
 * reliably inside Electron's Chromium, which sometimes kills continuous sessions.
 *
 * Only triggers on final (committed) recognition results to avoid
 * false positives from noisy interim (partial) transcripts.
 * Includes a 500ms debounce between triggers and guards against
 * re-triggering when Echo mode is already active.
 */
export const WakeWordListener: React.FC = () => {
  const { echoWakeWordEnabled, echoWakeWord, echoVoiceModeEnabled } = useOverlayStore();
  const recognitionRef = useRef<any>(null);
  const stoppedIntentionallyRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echoModeActiveRef = useRef(false);
  const lastTriggerRef = useRef(0);

  const startSession = useCallback(() => {
    const state = useOverlayStore.getState();
    const enabled = state.echoWakeWordEnabled || state.echoVoiceModeEnabled;
    // Voice mode always uses default wake phrase if none set
    const phrase = state.echoVoiceModeEnabled && !state.echoWakeWord
      ? 'hey hermes'
      : state.echoWakeWord;
    if (!enabled || !phrase) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[WakeWordListener] SpeechRecognition not available');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      // Use short non-continuous mode — more reliable in Electron
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 3;

      recognition.onresult = (event: any) => {
        // Only trigger on FINAL results — interim partials are noisy
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal) continue;

          for (let j = 0; j < result.length; j++) {
            const transcript = result[j].transcript.trim().toLowerCase().replace(/[.,!?]/g, '');
            const target = phrase.trim().toLowerCase().replace(/[.,!?]/g, '');
            if (transcript.includes(target)) {
              // Guard: don't trigger if Echo mode already active
              if (echoModeActiveRef.current) {
                console.log('[WakeWordListener] Wake phrase detected but Echo mode already active — ignoring.');
                return;
              }
              // Debounce: 500ms cooldown between triggers
              const now = Date.now();
              if (now - lastTriggerRef.current < 500) {
                console.log('[WakeWordListener] Wake phrase detected but triggered too recently — ignoring.');
                return;
              }
              lastTriggerRef.current = now;
              console.log('[WakeWordListener] Wake phrase detected! Triggering echo mode.');
              window.electronAPI?.triggerWakeWord?.();
              return;
            }
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          console.error('[WakeWordListener] Mic permission denied');
          return; // don't retry
        }
        // All other errors (no-speech, network, aborted) — just let onend restart
      };

      recognition.onend = () => {
        if (stoppedIntentionallyRef.current) return;
        // Restart after a short gap to minimize dead air
        restartTimerRef.current = setTimeout(startSession, 20);
      };

      recognitionRef.current = recognition;
      stoppedIntentionallyRef.current = false;
      recognition.start();
      console.log('[WakeWordListener] Session started, listening for:', phrase);
    } catch (err) {
      console.error('[WakeWordListener] Failed to start:', err);
      restartTimerRef.current = setTimeout(startSession, 1000);
    }
  }, []); // stable ref — reads state directly inside

  const stopSession = useCallback(() => {
    stoppedIntentionallyRef.current = true;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
      recognitionRef.current = null;
    }
  }, []);

  // Track whether Echo mode is currently active to avoid redundant triggers
  useEffect(() => {
    const unsubEnter = window.electronAPI?.onEnterEchoMode?.(() => {
      echoModeActiveRef.current = true;
    });
    return () => {
      unsubEnter?.();
    };
  }, []);

  useEffect(() => {
    const shouldListen = echoWakeWordEnabled || echoVoiceModeEnabled;
    const effectivePhrase = echoVoiceModeEnabled && !echoWakeWord ? 'hey hermes' : echoWakeWord;
    if (shouldListen && effectivePhrase) {
      echoModeActiveRef.current = false; // reset when freshly enabled
      startSession();
    } else {
      stopSession();
    }
    return stopSession;
  }, [echoWakeWordEnabled, echoVoiceModeEnabled, echoWakeWord, startSession, stopSession]);

  return null;
};
