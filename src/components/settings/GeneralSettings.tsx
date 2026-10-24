import React from 'react';
import { useOverlayStore } from '../../store/overlayStore';
import { Toggle } from '../ui/Toggle';
import { useToast } from '../ui/Toast';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

export const GeneralSettings: React.FC = () => {
  const {
    launchAtStartup, setLaunchAtStartup,
    theme, setTheme,
    accentColor, setAccentColor,
    fontFamily, setFontFamily,
    clearSession,
    autoCaptureContext, setAutoCaptureContext,
  } = useOverlayStore();

  const { toast } = useToast();
  const [confirmClear, setConfirmClear] = React.useState(false);

  const handleClearSessions = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }

    if (api?.clearAllSessions) {
      await api.clearAllSessions();
      clearSession();
      toast('success', 'All sessions cleared.');
      setConfirmClear(false);
    }
  };

  return (
    <div className="settings-section">
      {/* Startup */}
      <div className="settings-card">
        <div className="settings-card-copy">
          <span className="settings-card-title">Launch at Startup</span>
        </div>
        <Toggle checked={launchAtStartup} onChange={setLaunchAtStartup} />
      </div>

      {/* Screen capture context */}
      <div className="settings-card">
        <div className="settings-card-copy">
          <span className="settings-card-title">Screen Capture</span>
        </div>
        <Toggle checked={autoCaptureContext} onChange={setAutoCaptureContext} />
      </div>

      {/* Theme */}
      <div className="settings-card">
        <div className="settings-card-copy">
          <span className="settings-card-title">Theme</span>
        </div>
        <select className="settings-select" value={theme || 'system'} onChange={(e) => setTheme(e.target.value as any)}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      {/* Accent */}
      <div className="settings-card">
        <div className="settings-card-copy">
          <span className="settings-card-title">Accent</span>
        </div>
        <div className="color-picker">
          {['blue', 'purple', 'pink', 'red', 'orange', 'green', 'teal', 'indigo'].map(color => {
            const labels: Record<string, string> = {
              blue: 'Blue',
              purple: 'Purple',
              pink: 'Pink',
              red: 'Red',
              orange: 'Orange',
              green: 'Green',
              teal: 'Teal',
              indigo: 'Indigo',
            };
            return (
              <div key={color} className="color-swatch-wrapper" onClick={() => setAccentColor(color)}>
                <button
                  className={`color-swatch ${color} ${accentColor === color ? 'active' : ''}`}
                  onClick={() => setAccentColor(color)}
                  aria-label={`${labels[color]} accent color`}
                  aria-pressed={accentColor === color}
                  role="radio"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Font */}
      <div className="settings-card">
        <div className="settings-card-copy">
          <span className="settings-card-title">Font</span>
        </div>
        <select className="settings-select" value={fontFamily || 'system-ui'} onChange={(e) => setFontFamily(e.target.value)}>
          <option value="system-ui">System Default</option>
          <option value="Inter, sans-serif">Inter</option>
          <option value="Roboto, sans-serif">Roboto</option>
          <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
        </select>
      </div>

      {/* Clear sessions */}
      <div className="settings-card destructive">
        <div className="settings-card-copy">
          <span className="settings-card-title">Clear History</span>
        </div>
        <button 
          className={`settings-button ${confirmClear ? 'destructive-confirm' : 'destructive'}`}
          onClick={handleClearSessions}
        >
          {confirmClear ? 'Confirm' : 'Clear'}
        </button>
      </div>
    </div>
  );
};
