import React from 'react';
import { useOverlayStore } from '../../store/overlayStore';
import { Toggle } from '../ui/Toggle';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

export const WindowSettings: React.FC = () => {
  const { alwaysOnTop, setAlwaysOnTop, smallWindow, setSmallWindow } = useOverlayStore();
  
  const safeAlwaysOnTop = alwaysOnTop ?? true;
  const safeSmallWindow = smallWindow ?? false;

  const handleResetBounds = () => {
    if (api?.resetBounds) api.resetBounds();
  };

  return (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-label">
          <span>Compact Mode</span>
          <span className="settings-desc">Shrink the overlay footprint.</span>
        </div>
        <Toggle checked={safeSmallWindow} onChange={setSmallWindow} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Always on Top</span>
          <span className="settings-desc">Keep the overlay above other windows.</span>
        </div>
        <Toggle checked={safeAlwaysOnTop} onChange={setAlwaysOnTop} />
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Reset Window Position</span>
          <span className="settings-desc">Restore to bottom-right corner.</span>
        </div>
        <button className="mac-button" onClick={handleResetBounds}>Reset Position</button>
      </div>
    </div>
  );
};
