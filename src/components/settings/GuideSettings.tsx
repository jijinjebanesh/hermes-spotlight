import React from 'react';

export const GuideSettings: React.FC = () => {
  return (
    <div className="settings-section" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 className="settings-section-title" style={{ fontSize: '18px', marginBottom: '16px' }}>Hermes Overlay Guide</h3>
      
      <div className="settings-scroll-area" style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }}>
        
        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '14px' }}>Welcome to Hermes</h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
            Hermes is a desktop intelligence surface designed to be the thinnest possible membrane between human thought and machine capability. It lives on top of your workflow, ready exactly when you need it.
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '12px', fontSize: '14px' }}>Keyboard Shortcuts</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Toggle Overlay</span>
              <kbd style={{ background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '11px', color: 'var(--text-muted)' }}>Ctrl + Space</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Command Palette</span>
              <kbd style={{ background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '11px', color: 'var(--text-muted)' }}>Ctrl + K</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>New Session</span>
              <kbd style={{ background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '11px', color: 'var(--text-muted)' }}>Ctrl + N</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Voice Mode</span>
              <kbd style={{ background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '11px', color: 'var(--text-muted)' }}>Ctrl + E</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Close Overlay</span>
              <kbd style={{ background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '11px', color: 'var(--text-muted)' }}>Escape</kbd>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '14px' }}>Context Capture</h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5, marginBottom: '8px' }}>
            Click the scanner icon in the input bar to automatically capture your clipboard text and a screenshot of your primary display. This instantly provides Hermes with context about what you're looking at.
          </p>
        </div>

        <div>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '14px' }}>Echo Mode (Voice)</h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
            Activate Echo Mode to talk naturally with Hermes. Use the wake word "Hey Hermes" (if enabled in Settings) or press the microphone button. Echo mode uses high-speed streaming for minimal latency.
          </p>
        </div>

      </div>
    </div>
  );
};
