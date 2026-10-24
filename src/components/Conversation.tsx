import React, { useCallback } from 'react';
import { useOverlayStore, generateId } from '../store/overlayStore';
import { MessageBubble } from './MessageBubble';
import { getElectronAPI } from '../hooks/useElectronAPI';

const api = getElectronAPI();

const getStatusLabel = (mode: string) => {
  switch (mode) {
    case 'working': return 'Using tools';
    case 'running': return 'Working';
    case 'searching': return 'Searching';
    default: return 'Thinking';
  }
};

/** A single answer surface, paired with the active request in the search pill. */
export const Conversation: React.FC = () => {
  const { messages, streamState, addMessage, setStreamState } = useOverlayStore();
  const latestAssistant = messages.filter(message => message.role === 'assistant').at(-1);
  const hasResponseContent = Boolean(latestAssistant?.content?.trim() || latestAssistant?.segments?.length);
  const isWaitingForResponse = streamState.isStreaming && !hasResponseContent;

  const handleRetry = useCallback(() => {
    if (!latestAssistant || !api?.sendMessage) return;
    const state = useOverlayStore.getState();
    const assistantIndex = state.messages.findIndex(message => message.id === latestAssistant.id);
    if (assistantIndex < 0) return;

    let userMessage: string | null = null;
    let userIndex = -1;
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') {
        userMessage = state.messages[i].content;
        userIndex = i;
        break;
      }
    }
    if (!userMessage) return;

    useOverlayStore.setState({ messages: state.messages.slice(0, userIndex) });
    const sessionId = state.sessionId || generateId();
    addMessage({ id: generateId(), role: 'user', content: userMessage, timestamp: Date.now() });
    addMessage({ id: generateId(), role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true });
    setStreamState({ isStreaming: true, tokens: 0, duration: 0, mode: 'thinking' });
    api.sendMessage({
      text: userMessage,
      sessionId,
      toolMode: state.toolMode,
      provider: state.activeProvider,
      model: state.activeModel,
    });
  }, [latestAssistant, addMessage, setStreamState]);

  if (!latestAssistant && !streamState.isStreaming) return null;

  return (
    <section className="spotlight-answer-shell" aria-label="Hermes answer">
      <div className="spotlight-answer-card">
        {isWaitingForResponse && (
          <div className="spotlight-thinking-state" role="status" aria-live="polite">
            <span className="spotlight-thinking-dots" aria-hidden="true">
              <i /><i /><i />
            </span>
            <span>{getStatusLabel(streamState.mode)}…</span>
            {streamState.duration > 0 && <span className="spotlight-status-time">{streamState.duration}s</span>}
          </div>
        )}
        {streamState.isStreaming && hasResponseContent && (
          <header className="spotlight-answer-header" role="status" aria-live="polite">
            <span className="spotlight-answer-status">
              <i className="spotlight-status-dot" />
              {getStatusLabel(streamState.mode)}
              {streamState.duration > 0 && <span className="spotlight-status-time">{streamState.duration}s</span>}
            </span>
          </header>
        )}

        <div className="spotlight-answer-body">
          {latestAssistant && hasResponseContent && (
            <div className="message-row">
              <MessageBubble message={latestAssistant} onRetry={handleRetry} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
