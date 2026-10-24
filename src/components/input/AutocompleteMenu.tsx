import React from 'react';

export interface AutocompleteSuggestion {
  name: string;
  isDir: boolean;
  size: number;
  isCommand?: boolean;
  description?: string;
}

interface AutocompleteMenuProps {
  suggestions: AutocompleteSuggestion[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  type?: 'file' | 'command';
}

export const AutocompleteMenu: React.FC<AutocompleteMenuProps> = ({ 
  suggestions, 
  selectedIndex, 
  onSelect,
  type = 'file'
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div className={`autocomplete-menu ${type === 'command' ? 'command-menu' : 'file-menu'}`}>
      {type === 'command' && (
        <div className="autocomplete-header">
          <span>Hermes commands</span>
          <span className="autocomplete-header-mark">/</span>
        </div>
      )}
      <div className="autocomplete-items">
        {suggestions.map((sug, idx) => (
          <div
            key={sug.name + idx}
            className={`autocomplete-item ${idx === selectedIndex ? 'selected' : ''}`}
            onClick={() => onSelect(idx)}
          >
            <span className="autocomplete-name">
              {sug.isCommand && type === 'command' ? (
                <>
                  <span className="autocomplete-command">{sug.name}</span>
                  <span className="autocomplete-command-hint">{sug.description}</span>
                </>
              ) : (
                <>{sug.name}{sug.isDir ? '/' : ''}</>
              )}
            </span>
            {type === 'file' && !sug.isCommand && (
              <span className="autocomplete-meta">
                {sug.isDir ? 'dir' : (sug.size > 1024 * 1024 ? (sug.size / (1024 * 1024)).toFixed(1) + 'M' : (sug.size > 1024 ? Math.round(sug.size / 1024) + 'K' : sug.size + 'B'))}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="autocomplete-footer">
        {type === 'command' ? '↑ ↓ navigate   ·   ↵ open   ·   esc close' : '↑↓ to navigate · Tab/Enter to select · Esc to close'}
      </div>
    </div>
  );
};
