import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Cpu } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const preview = lines.slice(0, 2).join(' ').substring(0, 80);

  return (
    <div className="thinking-block">
      <button
        className="thinking-block-header"
        onClick={() => setExpanded(!expanded)}
      >
        <Cpu size={12} />
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="thinking-block-label">Thinking</span>
        {!expanded && (
          <span className="thinking-block-preview">{preview}…</span>
        )}
      </button>
      {expanded && (
        <div className="thinking-block-content selectable">
          {content}
        </div>
      )}
    </div>
  );
};
