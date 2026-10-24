import React, { useCallback } from 'react';
import { useOverlayStore } from '../store/overlayStore';
import { MessageBubble } from './MessageBubble';

/**
 * Simple non‑virtual message list – renders all messages directly.
 * This avoids the missing '@tanstack/react-virtual' dependency for now.
 */
export const MessageList: React.FC = () => {
  const { messages } = useOverlayStore(state => ({ messages: state.messages }));

  const itemKey = useCallback((index: number) => messages[index].id, [messages]);

  return (
    <div className="message-list" style={{ overflowY: 'auto', height: 'calc(100vh - 120px)' }}>
      {messages.map((msg, idx) => (
        <div key={itemKey(idx)} className="virtual-item">
          <MessageBubble message={msg} />
        </div>
      ))}
    </div>
  );
};
