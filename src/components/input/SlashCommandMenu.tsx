import React, { useEffect, useRef } from 'react';

export interface SlashCommand {
  command: string;
  description: string;
}

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ commands, selectedIndex, onSelect }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Scroll the selected item into view if it is not visible
    if (menuRef.current && selectedIndex >= 0) {
      const selectedItem = menuRef.current.children[selectedIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  if (commands.length === 0) return null;

  return (
    <div className="slash-command-menu" ref={menuRef}>
      {commands.map((cmd, idx) => (
        <div
          key={cmd.command}
          className={`slash-command-item ${idx === selectedIndex ? 'selected' : ''}`}
          onClick={() => onSelect(idx)}
        >
          <span className="slash-command-name">{cmd.command}</span>
          <span className="slash-command-desc">{cmd.description}</span>
        </div>
      ))}
    </div>
  );
};
