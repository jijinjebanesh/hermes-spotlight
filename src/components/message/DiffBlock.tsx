import React, { useState } from 'react';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';
import type { DiffLine } from '../../tool-parser';

interface DiffBlockProps {
  content: string;
  diffLines?: DiffLine[];
  title?: string;
}

export const DiffBlock: React.FC<DiffBlockProps> = ({ content, diffLines, title }) => {
  const [expanded, setExpanded] = useState(false);

  const lines: DiffLine[] = diffLines ?? [];

  // Default title from content
  let displayTitle = title ?? (lines.length > 0 && lines[0].filename
    ? lines[0].filename
    : (content.split('\n')[0] || 'File diff'));

  // Clean up git diff header paths like "a/file.py -> b/file.py"
  if (typeof displayTitle === 'string' && displayTitle.includes('->')) {
    const parts = displayTitle.split('->');
    let targetPath = parts[1].trim();
    // Remove any trailing stats like "+78-0" or "+78,-0"
    targetPath = targetPath.split(' ')[0];
    displayTitle = targetPath.replace(/^b\//, '').replace(/^b\\/, '');
  } else if (typeof displayTitle === 'string' && displayTitle.startsWith('--- a/')) {
      displayTitle = displayTitle.split('\n')[0] || displayTitle;
  }
  
  if (typeof displayTitle === 'string' && displayTitle.startsWith('diff --git')) {
     displayTitle = "File diff";
  }

  if (!content && lines.length === 0) return null;

  return (
    <div className="diff-container">
      <button
        className="diff-header"
        onClick={() => setExpanded(!expanded)}
        style={{ width: '100%', cursor: 'pointer', border: 'none', textAlign: 'left', gap: '6px', justifyContent: 'flex-start' }}
      >
        {expanded ? <ChevronDown size={14} style={{flexShrink:0}} /> : <ChevronRight size={14} style={{flexShrink:0}} />}
        <FileText size={14} style={{flexShrink:0}} />
        <span className="diff-title" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayTitle}</span>
        {lines.length > 0 && (
          <span className="diff-stats" style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <span className="diff-stat diff-stat-adds" style={{ color: 'var(--color-success)' }}>+{lines.filter(l => l.type === 'plus').length}</span>
            <span className="diff-stat diff-stat-removes" style={{ color: 'var(--color-error)' }}>-{lines.filter(l => l.type === 'minus').length}</span>
          </span>
        )}
      </button>
      {expanded && (
        <div className="diff-content selectable">
          {lines.length > 0 ? (
            lines.map((line, i) => {
              let cls = 'diff-line';
              if (line.type === 'plus') cls += ' diff-add';
              else if (line.type === 'minus') cls += ' diff-remove';
              else if (line.type === 'header') cls += ' diff-header';
              else if (line.type === 'hunk') cls += ' diff-hunk';
              else if (line.type === 'context') cls += ' diff-context';
              return (
                <div key={i} className={cls}>
                  {line.text || '\u00A0'}
                </div>
              );
            })
          ) : (
            content.split('\n').map((line, i) => {
              let cls = 'diff-line';
              if (line.startsWith('+')) cls += ' diff-add';
              else if (line.startsWith('-')) cls += ' diff-remove';
              else if (line.startsWith('@@')) cls += ' diff-hunk';
              else if (line.startsWith('---') || line.startsWith('+++')) cls += ' diff-header';
              else if (line.startsWith(' ')) cls += ' diff-context';
              return (
                <div key={i} className={cls}>
                  {line || '\u00A0'}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
