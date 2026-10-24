import React, { useState, useEffect } from 'react';
import { useOverlayStore } from '../../store/overlayStore';

export const HotkeySettings: React.FC = () => {
  const { globalHotkey, setGlobalHotkey } = useOverlayStore();
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [tempKeys, setTempKeys] = useState<string[]>([]);
  
  const safeGlobalHotkey = globalHotkey || 'CommandOrControl+Alt+H';

  useEffect(() => {
    if (!recordingHotkey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const key = e.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        if (!tempKeys.includes(key)) setTempKeys([...tempKeys, key]);
        return;
      }
      
      const modifiers = [];
      if (e.ctrlKey || e.metaKey) modifiers.push('CommandOrControl');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');
      
      const keyName = key.length === 1 ? key.toUpperCase() : key;
      const finalHotkey = [...modifiers, keyName].join('+');
      
      setGlobalHotkey(finalHotkey);
      setRecordingHotkey(false);
      setTempKeys([]);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [recordingHotkey, tempKeys, setGlobalHotkey]);

  return (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-label">
          <span>Trigger Hotkey</span>
          <span className="settings-desc">Show/Hide the overlay instantly from anywhere.</span>
        </div>
        <button 
          className={`mac-button hotkey-btn ${recordingHotkey ? 'recording' : ''}`}
          onClick={() => setRecordingHotkey(true)}
        >
          {recordingHotkey ? (tempKeys.length > 0 ? tempKeys.join('+') + '...' : 'Press keys...') : safeGlobalHotkey.replace('CommandOrControl', 'Ctrl/Cmd')}
        </button>
      </div>
      {recordingHotkey && <div className="settings-hint">Press your desired key combination (e.g., Ctrl+Shift+A). Escape to cancel.</div>}
      <div className="settings-hint" style={{ marginTop: '12px', color: '#f59e0b' }}>
        ⚠️ Setting a custom hotkey will completely override F2. Only your configured key will toggle the overlay.
      </div>
    </div>
  );
};
