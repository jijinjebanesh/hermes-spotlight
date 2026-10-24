import React from 'react';
import { Wrench, Clock, Paperclip } from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';

/**
 * StatusBar — Conditional 28px bottom bar.
 * 
 * Only appears when streaming or in multi-session/workspace mode.
 * Shows: tool count, session duration, attachment count.
 */
export const StatusBar: React.FC = () => {
  const streamState = useOverlayStore(s => s.streamState);
  const messages = useOverlayStore(s => s.messages);
  const pendingAttachments = useOverlayStore(s => s.pendingAttachments);

  // Count tool calls across all messages
  const toolCount = React.useMemo(() => {
    return messages.reduce((count, msg) => {
      const streamedTools = msg.segments?.filter(segment =>
        segment.type === 'tool_start' || segment.type === 'tool_complete'
      ).length || 0;
      return count + Math.max(msg.toolCalls?.length || 0, streamedTools);
    }, 0);
  }, [messages]);

  // Format duration
  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const showDuration = streamState.duration > 0;
  const showTools = toolCount > 0;
  const showAttachments = pendingAttachments.length > 0;

  // Don't render if nothing to show
  if (!showDuration && !showTools && !showAttachments && !streamState.isStreaming) {
    return null;
  }

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {showTools && (
          <span className="status-bar-item">
            <Wrench />
            <span>{toolCount} tool{toolCount !== 1 ? 's' : ''}</span>
          </span>
        )}
        {showDuration && (
          <span className="status-bar-item">
            <Clock />
            <span>{formatDuration(streamState.duration)}</span>
          </span>
        )}
      </div>

      <div className="status-bar-right">
        {showAttachments && (
          <span className="status-bar-item">
            <Paperclip />
            <span>{pendingAttachments.length} file{pendingAttachments.length !== 1 ? 's' : ''}</span>
          </span>
        )}
        {streamState.tokens > 0 && (
          <span className="status-bar-item">
            <span
              className="status-bar-dot"
              style={{ background: 'var(--accent)' }}
            />
            <span>{streamState.tokens} tokens</span>
          </span>
        )}
      </div>
    </div>
  );
};
