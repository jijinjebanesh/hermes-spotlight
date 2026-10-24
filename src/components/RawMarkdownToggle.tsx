import React from 'react';

interface Props {
  enabled: boolean;
  isRaw: boolean;
  onToggle: () => void;
}

export const RawMarkdownToggle: React.FC<Props> = ({ enabled, isRaw, onToggle }) => {
  if (!enabled) return null;
  return (
    <button className="raw-toggle" onClick={onToggle} title={isRaw ? 'Show structured view' : 'Show raw markdown'}>
      {isRaw ? '🗒 Structured' : '🗒 Raw'}
    </button>
  );
};
