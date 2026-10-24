import React from 'react';
import { MessageSquarePlus, X, Settings, TerminalSquare, Zap, Keyboard } from 'lucide-react';
import { useOverlayStore } from '../store/overlayStore';
import { getElectronAPI } from '../hooks/useElectronAPI';
import { ModelSelector } from './header/ModelSelector';
import { SessionHistory } from './header/SessionHistory';

const api = getElectronAPI();

export const Header: React.FC = () => {
  const { newSession, setSettingsOpen, backgroundTasks, toolMode } = useOverlayStore();

  const handleClose = () => api?.closeOverlay();
  const handleNewChat = () => newSession();
  const handleSettings = () => setSettingsOpen(true);
  const handleTerminal = () => {
    if (api?.openTerminal) api.openTerminal();
  };

  const runningTasks = backgroundTasks.filter((t: any) => t.status === 'running');
  const hasRunning = runningTasks.length > 0;

  // Get tool mode label with icon
  const getToolModeInfo = () => {
    switch (toolMode) {
      case 'all': return { label: 'Full tools', color: 'var(--accent-primary)' };
      case 'terminal': return { label: 'Terminal', color: 'var(--accent-warning)' };
      case 'none': return { label: 'Chat only', color: 'var(--text-muted)' };
      default: return { label: 'Full tools', color: 'var(--accent-primary)' };
    }
  };
  
  const toolModeInfo = getToolModeInfo();

  return (
    <header className="header">
      {/* LEFT: Status cluster */}
      <div className="header-left">
        <ModelSelector />

        <div className="header-status-cluster">
          <div 
            className="tool-mode-pill" 
            style={{ 
              color: toolModeInfo.color,
              borderColor: `color-mix(in srgb, ${toolModeInfo.color} 25%, transparent)`
            }}
            title={`Tool mode: ${toolModeInfo.label}`}
          >
            <Zap size={9} strokeWidth={2} style={{ opacity: 0.8 }} />
            {toolModeInfo.label}
          </div>

          <div className="connection-dot" title="Hermes backend connected" role="status" aria-label="Backend connected" />
        </div>
      </div>

      {/* CENTER: Product identity */}
      <div className="header-center">
        <span className="header-title">Hermes</span>
      </div>

      {/* RIGHT: Action buttons */}
      <nav className="header-actions" role="navigation" aria-label="Header actions">
        <SessionHistory />

        {hasRunning && (
          <div
            className="header-btn header-bg-task"
            title={`${runningTasks.length} background task${runningTasks.length > 1 ? 's' : ''} running`}
          >
            <Zap size={13} className="spin-slow" />
            <span className="bg-task-badge">{runningTasks.length}</span>
          </div>
        )}

        <div className="header-divider" aria-hidden="true" />

        <button
          className="header-btn"
          onClick={handleTerminal}
          title="Open Terminal (⌘T)"
          aria-label="Open Terminal"
          accessKey="t"
        >
          <TerminalSquare size={14} strokeWidth={1.5} />
        </button>

        <button
          className="header-btn"
          onClick={handleSettings}
          title="Settings"
          aria-label="Open settings"
          accessKey=","
        >
          <Settings size={14} strokeWidth={1.5} />
        </button>

        <button
          className="header-btn new-chat-btn"
          onClick={handleNewChat}
          title="New Chat (⌘N)"
          aria-label="Start new chat"
          accessKey="n"
        >
          <MessageSquarePlus size={14} strokeWidth={1.5} />
        </button>

        <button
          className="header-btn header-close-btn"
          onClick={handleClose}
          title="Close (Esc)"
          aria-label="Close overlay"
          accessKey="e"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </nav>
    </header>
  );
};
