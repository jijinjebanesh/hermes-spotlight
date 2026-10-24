import React, { useEffect, useCallback, useRef, useState } from 'react';
import { FolderOpen, Sparkles } from 'lucide-react';
import { Conversation } from '../components/Conversation';
import { InputBar } from '../components/InputBar';
import { CommandPalette } from '../components/command/CommandPalette';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import { GuideModal } from '../components/GuideModal';
import { useOverlayStore, generateId } from '../store/overlayStore';
import type { StreamSegment } from '../store/overlayStore';
import { EchoMode } from '../components/EchoMode';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToastContainer } from '../components/ui/Toast';
import { getElectronAPI } from '../hooks/useElectronAPI';

const api = getElectronAPI();

export const App: React.FC = () => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const dragCounter = useRef(0);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEchoMode, setIsEchoMode] = useState(false);
  const [showDragOverlay, setShowDragOverlay] = useState(false);
  const [inputPopoverHeight, setInputPopoverHeight] = useState(0);

  const {
      messages,
      streamState,
      toolMode,
      inputHistory,
      pendingAttachments,
      localMode,
      activeModel,
      activeProvider,
      inventory,
      sessionId,
      setToolMode,
      setLocalMode,
      setActiveModel,
      setActiveProvider,
      addMessage,
      updateLastMessage,
      appendSegmentToLast,
      clearSession,
      newSession,
      hydrateSession,
      setStreamState,
      cycleToolMode,
      setInventory,
      setInventoryLoading,
      addPendingAttachments,
      removePendingAttachment,
      clearPendingAttachments,
      addToHistory,
      theme,
      accentColor,
    } = useOverlayStore();

  const isStreaming = streamState.isStreaming;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = accentColor;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      root.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme, accentColor]);

  useEffect(() => api?.onFocusInput(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }), []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !api?.resizeOverlayContent || typeof ResizeObserver === 'undefined') return;

    let resizeTimer: number | undefined;
    let latestHeight = 0;
    let lastRequestedHeight = 0;
    const resizeToStage = () => {
      // Match the native window to the content. The stage's CSS margins are
      // included here; keeping the buffer small avoids a large transparent
      // hit target around the otherwise compact search surface.
      const stageHeight = Math.ceil(stage.getBoundingClientRect().height + 18);
      latestHeight = isSettingsOpen
        ? 420
        : isPaletteOpen
          ? Math.max(stageHeight, 410)
          : stageHeight + inputPopoverHeight;
      latestHeight = Math.min(latestHeight, 420);
      if (Math.abs(latestHeight - lastRequestedHeight) < 8) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        lastRequestedHeight = latestHeight;
        api.resizeOverlayContent(latestHeight);
      }, 80);
    };
    const observer = new ResizeObserver(resizeToStage);
    observer.observe(stage);
    resizeToStage();
    return () => {
      observer.disconnect();
      window.clearTimeout(resizeTimer);
    };
  }, [inputPopoverHeight, isPaletteOpen, isSettingsOpen]);

  useEffect(() => {
    api?.getConfig().then(config => {
      if (config.triggerHotkey) useOverlayStore.setState({ globalHotkey: config.triggerHotkey });
      const state = useOverlayStore.getState();
      if (config.activeProvider) state.setActiveProvider(config.activeProvider);
      if (config.activeModel) state.setActiveModel(config.activeModel);
    }).catch(() => {});
  }, []);

  // Load the model/provider inventory once so Settings and the pickers have
  // data before the user presses Refresh.
  useEffect(() => {
    if (!api?.getInventory) return;
    if (useOverlayStore.getState().inventory.length > 0) return;

    setInventoryLoading(true);
    api.getInventory()
      .then(payload => {
        if (!payload?.providers) return;
        setInventory(payload.providers);
        const state = useOverlayStore.getState();
        if (!state.activeProvider && payload.provider) setActiveProvider(payload.provider);
        if (!state.activeModel && payload.model) setActiveModel(payload.model);
      })
      .catch(error => console.error('[App] inventory load failed', error))
      .finally(() => setInventoryLoading(false));
  }, [setInventory, setInventoryLoading, setActiveProvider, setActiveModel]);

  // Drag-and-drop file attachment
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current++;
    setShowDragOverlay(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current--;
    if (dragCounter.current === 0) setShowDragOverlay(false);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); dragCounter.current = 0; setShowDragOverlay(false);
        if (e.dataTransfer.files.length > 0 && api?.readDroppedFile) {
          const results = await Promise.all([...e.dataTransfer.files].map(file => api.readDroppedFile(file)));
          const attachments = results
            .filter((result): result is NonNullable<typeof result> => Boolean(result?.name))
            .map(result => ({
              id: generateId(), name: result.name, path: result.path,
              content: result.content, tooBig: result.tooBig, size: result.size,
              ext: result.ext ?? '', isImage: result.isImage ?? false,
            }));
          if (attachments.length) addPendingAttachments(attachments);
        }
      }, [addPendingAttachments]);

  // Input handling
  const handleSubmit = useCallback(async () => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (!text && pendingAttachments.length === 0) return;
    input.value = '';
    input.style.height = 'auto';
    if (text) addToHistory(text);

    addMessage({ id: generateId(), role: 'user', content: text || '', timestamp: Date.now(), attachments: pendingAttachments });
    clearPendingAttachments();

    const sessionIdForSend = sessionId || generateId();
    setStreamState({ isStreaming: true, tokens: 0, duration: 0, mode: 'thinking' });
    api?.sendMessage?.({
      text,
      file: pendingAttachments[0]?.path,
      sessionId: sessionIdForSend,
      toolMode,
      provider: activeProvider,
      model: activeModel,
    });
  }, [pendingAttachments, sessionId, toolMode, activeProvider, activeModel, addMessage, setStreamState, clearPendingAttachments, addToHistory]);

  const handleStop = useCallback(() => { api?.abortStream?.(); setStreamState({ isStreaming: false }); }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) handleStop();
      else handleSubmit();
    }
  }, [isStreaming, handleSubmit, handleStop]);

  const handleInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const h = Math.min(input.scrollHeight, 200);
    input.style.height = `${h}px`;
  }, []);

  // Stream handling. Read the latest transcript for each tool completion so
  // event listeners stay mounted while a response is streaming.
  useEffect(() => {
    if (!api) return;
    const cleanup = api.onStreamSegment((segment: StreamSegment) => {
      if (segment.type === 'status') setStreamState({ tokens: segment.tokens, duration: segment.durationS, mode: 'idle' });
      else if (segment.type === 'text') appendSegmentToLast({ type: 'text', content: segment.content });
      else if (segment.type === 'tool_start') {
        setStreamState({ mode: 'working' });
        appendSegmentToLast({ type: 'tool_start', toolId: segment.toolId, name: segment.name, args: segment.args, display: segment.display });
      }
      else if (segment.type === 'tool_complete') {
        const current = useOverlayStore.getState().messages.at(-1);
        const idx = current?.segments?.findIndex(s => s.type === 'tool_start' && s.toolId === segment.toolId) ?? -1;
        if (idx >= 0) {
          const newSegments = [...(current?.segments || [])];
          newSegments[idx] = { type: 'tool_complete', toolId: segment.toolId, name: segment.name, args: segment.args, result: segment.result, durationS: segment.durationS, inlineDiff: segment.inlineDiff, diffLines: segment.diffLines, error: segment.error, display: segment.display };
          updateLastMessage(msg => ({ ...msg, segments: newSegments }));
        } else appendSegmentToLast(segment);
      } else if (segment.type === 'thinking') appendSegmentToLast({ type: 'thinking', content: segment.content });
      else if (segment.type === 'reasoning') appendSegmentToLast({ type: 'reasoning', content: segment.content });
      else if (segment.type === 'diff') appendSegmentToLast({ type: 'diff', content: segment.content, diffLines: segment.diffLines });
      else if (segment.type === 'clarify') {
        // Hermes' CLI clarification callback is headless: it can emit the prompt
        // but cannot wait for a choice from this window. Treat the structured
        // question as a UI handoff so the user can answer it immediately. The
        // ClarifyBlock answer starts the next turn in the same Hermes session.
        appendSegmentToLast({ type: 'clarify', question: segment.question, choices: segment.choices, multiSelect: segment.multiSelect });
        setStreamState({ isStreaming: false, mode: 'idle' });
        updateLastMessage(message => ({ ...message, isStreaming: false }));
      }
      else if (segment.type === 'file_notice') appendSegmentToLast({ type: 'file_notice', filename: segment.filename });
    });
    return cleanup;
  }, [appendSegmentToLast, setStreamState, updateLastMessage]);

  useEffect(() => {
    if (!api) return;
    const cleanup = api.onStreamEnd(() => {
      setStreamState({ isStreaming: false });
      const latest = useOverlayStore.getState().messages.at(-1);
      if (latest?.segments) {
        const settledSegments = latest.segments.map(segment =>
          segment.type === 'tool_start'
            ? { type: 'tool_complete' as const, toolId: segment.toolId, name: segment.name, args: segment.args, display: segment.display }
            : segment
        );
        updateLastMessage(message => ({ ...message, isStreaming: false, segments: settledSegments }));
      } else {
        updateLastMessage(message => ({ ...message, isStreaming: false }));
      }
    });
    return cleanup;
  }, [api, setStreamState, updateLastMessage]);

  useEffect(() => {
    if (!api) return;
    const cleanup = api.onStreamError((error) => {
      setStreamState({ isStreaming: false });
      const hasAssistant = useOverlayStore.getState().messages.at(-1)?.role === 'assistant';
      if (hasAssistant) {
        updateLastMessage(message => ({ ...message, content: message.content || `Hermes couldn't finish this request: ${error}`, isStreaming: false, cancelled: true }));
      } else {
        addMessage({ id: generateId(), role: 'assistant', content: `Hermes couldn't finish this request: ${error}`, timestamp: Date.now(), cancelled: true });
      }
    });
    return cleanup;
  }, [addMessage, setStreamState, updateLastMessage]);

  // Echo mode
  useEffect(() => {
    if (!api) return;
    const cleanup = api.onEnterEchoMode(() => { setIsEchoMode(true); });
    return cleanup;
  }, [api]);

  const handleEchoExit = useCallback((turns?: import('../hooks/useEchoSession').EchoSessionTurn[]) => {
    setIsEchoMode(false);
    if (!turns?.length) return;
    const additions = turns.map((turn, index) => ({
      id: generateId(), role: turn.role === 'agent' ? 'assistant' as const : 'user' as const, content: turn.text, timestamp: turn.timestamp || Date.now() + index,
    } as const));
    additions.forEach(message => addMessage(message));
  }, [addMessage]);

  const handleEchoSwitchToChat = useCallback((turns?: import('../hooks/useEchoSession').EchoSessionTurn[]) => {
    handleEchoExit(turns);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [handleEchoExit]);

  const focusInput = useCallback(() => { inputRef.current?.focus(); }, []);

  const enterEchoMode = useCallback(() => { setIsEchoMode(true); }, []);

  const handleSwitchSession = useCallback(async (sid: string) => {
    if (!api?.getSession) return;
    const msgs = await api.getSession(sid);
    if (Array.isArray(msgs)) { hydrateSession(sid, msgs); setIsPaletteOpen(false); }
  }, [api, hydrateSession]);

  const shellClasses = [
    'overlay-shell',
    'spotlight-app',
    isSettingsOpen ? 'settings-open' : '',
    isPaletteOpen ? 'palette-open' : '',
    isEchoMode ? 'echo-live' : '',
    streamState.isStreaming ? 'streaming' : '',
  ].filter(Boolean).join(' ');

  return (
    <ErrorBoundary>
      <ToastContainer>
        <div
          className={shellClasses}
          data-surface="query"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {showDragOverlay && (
            <div className="drag-overlay">
              <div className="drag-overlay-content">
                <FolderOpen size={32} strokeWidth={1.5} />
                <span>Drop file to attach</span>
              </div>
            </div>
          )}

          <main className="spotlight-stage" ref={stageRef}>
            <div className="spotlight-search-shell">
              {isEchoMode ? (
                <EchoMode onExit={handleEchoExit} onSwitchToChat={handleEchoSwitchToChat} />
              ) : (
                <>
                  <span className="spotlight-orb" aria-hidden="true">
                    <Sparkles size={17} strokeWidth={1.7} />
                  </span>
                  <InputBar
                    inputRef={inputRef}
                    onOpenModelPicker={() => setIsPaletteOpen(true)}
                    onOpenNavigator={() => setIsPaletteOpen(true)}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                    onPopoverHeightChange={setInputPopoverHeight}
                  />
                </>
              )}
            </div>

            <Conversation />
          </main>

          <CommandPalette
            isOpen={isPaletteOpen}
            onClose={() => setIsPaletteOpen(false)}
            onNewSession={() => { newSession(); focusInput(); }}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onSwitchSession={handleSwitchSession}
            onEnterEchoMode={enterEchoMode}
          />

          <SettingsPanel
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />

          <GuideModal />
        </div>

      </ToastContainer>
    </ErrorBoundary>
  );
};
