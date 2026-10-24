import { useEffect } from 'react';

interface EchoKeyboardOptions {
  onEscape: () => void;
  onToggleMute: () => void;
  onToggleTextInput: () => void;
  showTextInput: boolean;
}

export const useEchoKeyboard = ({ onEscape, onToggleMute, onToggleTextInput, showTextInput }: EchoKeyboardOptions) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape();
        return;
      }
      
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onToggleMute();
      }
      
      if (e.key === 't' && !showTextInput && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onToggleTextInput();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, onToggleMute, onToggleTextInput, showTextInput]);
};
