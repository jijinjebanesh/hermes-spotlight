import React, { useState, useRef } from 'react';
import { Copy, RotateCw, Edit2, Check, Volume2, Square } from 'lucide-react';
import { generateId, useOverlayStore, type Message } from '../store/overlayStore';
import { MarkdownContent } from './message/MarkdownContent';
import { DiffBlock } from './message/DiffBlock';
import { ToolActivityPill } from './message/ToolActivityPill';
import { ThinkingBlock } from './message/ThinkingBlock';
import { ClarifyBlock } from './message/ClarifyBlock';
import { getElectronAPI } from '../hooks/useElectronAPI';

const api = getElectronAPI();

interface MessageBubbleProps {
  message: Message;
  onRetry?: () => void;
  onEdit?: () => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({ message, onRetry, onEdit }) => {
  const [copied, setCopied] = useState(false);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleCopyText = () => {
    let textToCopy = message.content || '';
    if (!textToCopy && message.segments) {
      const textSegments = message.segments.filter((s) => s.type === 'text');
      textToCopy = textSegments.map((s) => s.content).join('\n\n');
    }
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReadAloud = () => {
    if (isReadingAloud && ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.currentTime = 0;
      ttsAudioRef.current = null;
      setIsReadingAloud(false);
      return;
    }
    let textToRead = message.content || '';
    if (!textToRead && message.segments) {
      const textSegments = message.segments.filter((s) => s.type === 'text');
      textToRead = textSegments.map((s) => s.content).join('\n\n');
    }
    if (!textToRead.trim()) return;
    api?.synthesizeSpeech?.({ text: textToRead }).then((result) => {
      if (!Array.isArray(result) || result.length === 0) return;
      const audioArray = result;
      const audioBuffer = new Uint8Array(audioArray).buffer;
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      ttsAudioRef.current = audio;
      audio.onended = () => {
        setIsReadingAloud(false);
        URL.revokeObjectURL(audioUrl);
        ttsAudioRef.current = null;
      };
      audio.onerror = () => {
        setIsReadingAloud(false);
        URL.revokeObjectURL(audioUrl);
        ttsAudioRef.current = null;
      };
      audio.play().catch(() => {
        setIsReadingAloud(false);
        URL.revokeObjectURL(audioUrl);
        ttsAudioRef.current = null;
      });
      setIsReadingAloud(true);
    }).catch(() => {
      setIsReadingAloud(false);
    });
  };

  const renderStructuredSegments = () => {
    if (!message.segments) return null;
    const rendered: React.ReactNode[] = [];
    let textBuffer: string[] = [];
    let textGroup = 0;
    let toolBuffer: any[] = [];
    let toolGroup = 0;

    const flushText = () => {
      const content = textBuffer.join('\n').trim();
      if (content) {
        rendered.push(
          <div key={`text-${textGroup++}`} className="hermes-terminal-panel selectable">
            <div className="hermes-panel-header">
              <span className="hermes-panel-corner">╭─</span>
              <span className="hermes-panel-title">☤ Hermes</span>
              <span className="hermes-panel-line" />
              <span className="hermes-panel-corner">╮</span>
            </div>
            <div className="hermes-panel-content">
              <MarkdownContent content={content} />
            </div>
            <div className="hermes-panel-footer">
              <span className="hermes-panel-corner">╰</span>
              <span className="hermes-panel-line" />
              <span className="hermes-panel-corner">╯</span>
            </div>
          </div>
        );
      }
      textBuffer = [];
    };

    const flushTools = () => {
      if (toolBuffer.length > 0) {
        rendered.push(
          <ToolActivityPill key={`tools-${toolGroup++}`} segments={toolBuffer} />
        );
        toolBuffer = [];
      }
    };

    message.segments.forEach((seg, idx) => {
      if (seg.type === 'text') {
        flushTools();
        textBuffer.push(seg.content || '');
        return;
      }

      if (seg.type === 'tool_start' || seg.type === 'tool_complete') {
        flushText();
        toolBuffer.push(seg);
        return;
      }

      flushText();
      flushTools();

      switch (seg.type) {
        case 'diff':
          rendered.push(<DiffBlock key={`diff-${idx}`} content={seg.content || ''} diffLines={seg.diffLines as any} />);
          break;
        case 'clarify':
          rendered.push(
            <ClarifyBlock
              key={`clarify-${idx}`}
              question={seg.question || ''}
              choices={seg.choices}
              multiSelect={seg.multiSelect}
              answer={seg.answer}
              onAnswer={(answer) => {
                if (!api?.sendMessage) return;
                const state = useOverlayStore.getState();
                const answerText = Array.isArray(answer) ? JSON.stringify(answer) : answer;
                const followup = `Answer to your clarification, “${seg.question || ''}”: ${answerText}\n\nContinue the original request using this answer.`;
                state.addMessage({ id: generateId(), role: 'user', content: `Answer: ${Array.isArray(answer) ? answer.join(', ') : answer}`, timestamp: Date.now() });
                state.addMessage({ id: generateId(), role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true });
                state.setStreamState({ isStreaming: true, tokens: 0, duration: 0, mode: 'thinking' });
                api.sendMessage({
                  text: followup,
                  sessionId: state.sessionId,
                  toolMode: state.toolMode,
                  provider: state.activeProvider,
                  model: state.activeModel,
                });
              }}
            />
          );
          break;
        case 'file_notice':
          rendered.push(
            <div key={`file-${idx}`} className="hermes-file-notice">
              <span className="hermes-file-notice-icon">📄</span>
              <span>Detected file: <strong>{seg.filename}</strong></span>
            </div>
          );
          break;
        case 'thinking':
          rendered.push(<ThinkingBlock key={`thinking-${idx}`} content={seg.content || ''} />);
          break;
        case 'reasoning':
          rendered.push(
            <div key={`reasoning-${idx}`} className="hermes-reasoning-panel selectable">
              <div className="hermes-reasoning-header">
                <span className="hermes-reasoning-corner">┌─</span>
                <span className="hermes-reasoning-title">Reasoning</span>
                <span className="hermes-reasoning-line" />
                <span className="hermes-reasoning-corner">┐</span>
              </div>
              <div className="hermes-reasoning-content">{seg.content}</div>
              <div className="hermes-reasoning-footer">
                <span className="hermes-reasoning-corner">└</span>
                <span className="hermes-reasoning-line" />
                <span className="hermes-reasoning-corner">┘</span>
              </div>
            </div>
          );
          break;
      }
    });

    flushText();
    flushTools();
    return rendered;
  };

  const renderMessageActions = () => (
    <div className="message-actions-toolbar">
      <button className="message-action-btn" onClick={handleCopyText} title="Copy text">
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      {message.role === 'assistant' && (
        <button
          className="message-action-btn"
          onClick={handleReadAloud}
          title={isReadingAloud ? 'Stop reading' : 'Read aloud'}
        >
          {isReadingAloud ? <Square size={11} fill="currentColor" /> : <Volume2 size={12} />}
        </button>
      )}
      {onEdit && message.role === 'user' && (
        <button className="message-action-btn" onClick={onEdit} title="Edit message">
          <Edit2 size={12} />
        </button>
      )}
      {onRetry && message.role === 'assistant' && (
        <button className="message-action-btn" onClick={onRetry} title="Retry response">
          <RotateCw size={12} />
        </button>
      )}
    </div>
  );

  if (message.role === 'user') {
    return (
      <div className="hermes-user-turn">
        <div className="hermes-terminal-divider" />
        <div className="hermes-user-bubble selectable">
          <span className="hermes-user-bullet">●</span>
          <div className="hermes-user-main">
            <div className="hermes-user-text">{message.content}</div>
          </div>
          <div className="message-actions-container">
            {renderMessageActions()}
          </div>
        </div>
      </div>
    );
  }

  const hasSegments = message.segments && message.segments.length > 0;

  return (
    <div className="hermes-assistant-turn" style={{ display: 'flex', flexDirection: 'column', width: '100%', position: 'relative' }}>
      {renderStructuredSegments()}

      {!hasSegments && message.content && (
        <div className="hermes-terminal-panel selectable">
          <div className="hermes-panel-header">
            <span className="hermes-panel-corner">╭─</span>
            <span className="hermes-panel-title">☤ Hermes</span>
            <span className="hermes-panel-line" />
            <span className="hermes-panel-corner">╮</span>
          </div>
          <div className="hermes-panel-content">
            <MarkdownContent content={message.content} />
          </div>
          <div className="hermes-panel-footer">
            <span className="hermes-panel-corner">╰</span>
            <span className="hermes-panel-line" />
            <span className="hermes-panel-corner">╯</span>
          </div>
        </div>
      )}

      {message.cancelled && (
        <span className="message-cancelled">(cancelled)</span>
      )}

      {!message.isStreaming && (
        <div className="message-actions-container-assistant">
          {renderMessageActions()}
        </div>
      )}
    </div>
  );
});
