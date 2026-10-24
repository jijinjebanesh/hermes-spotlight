import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Sun, Palette, Bot, Mic, Brain, Database,
  X, RotateCw, Trash2, Keyboard, Check,
  Zap, Monitor, Terminal, MessageSquare
} from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';
import { ProviderSettings } from './ProviderSettings';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsSection = 'general' | 'appearance' | 'ai-engine' | 'voice' | 'memory' | 'data';

interface SectionDef {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'general', label: 'General', icon: <Settings size={16} />, description: 'Startup, hotkeys, window behavior' },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} />, description: 'Theme, accent color, font' },
  { id: 'ai-engine', label: 'AI Engine', icon: <Bot size={16} />, description: 'Provider, model, tool mode' },
  { id: 'voice', label: 'Voice', icon: <Mic size={16} />, description: 'TTS, wake word, clap detection' },
  { id: 'memory', label: 'Memory', icon: <Brain size={16} />, description: 'Agent memory, user profile' },
  { id: 'data', label: 'Data', icon: <Database size={16} />, description: 'Clear history, reset' },
];

const ACCENT_COLORS = [
  { id: 'blue', color: '#3B82F6', label: 'Blue' },
  { id: 'purple', color: '#A855F7', label: 'Purple' },
  { id: 'pink', color: '#EC4899', label: 'Pink' },
  { id: 'red', color: '#EF4444', label: 'Red' },
  { id: 'orange', color: '#F97316', label: 'Orange' },
  { id: 'green', color: '#22C55E', label: 'Green' },
  { id: 'teal', color: '#14B8A6', label: 'Teal' },
  { id: 'indigo', color: '#6366F1', label: 'Indigo' },
];

const EDGE_TTS_VOICES = [
  { id: 'en-US-AriaNeural', label: 'Aria' },
  { id: 'en-US-JennyNeural', label: 'Jenny' },
  { id: 'en-US-GuyNeural', label: 'Guy' },
  { id: 'en-US-DavisNeural', label: 'Davis' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia' },
  { id: 'en-GB-RyanNeural', label: 'Ryan' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha' },
  { id: 'en-IN-NeerjaNeural', label: 'Neerja' },
];

const FONTS = [
  { value: 'system-ui', label: 'System Default' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
];

/**
 * SettingsPanel — Top tab navigation with full-width content.
 * Works equally well in normal and compact modes.
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const store = useOverlayStore();
  const api = (window as any).electronAPI;

  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  // Hotkey recording
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);
  const [hotkeyDisplay, setHotkeyDisplay] = useState(store.globalHotkey);

  // Memory
  const [memoryContent, setMemoryContent] = useState('');
  const [userContent, setUserContent] = useState('');
  const [memoryDirty, setMemoryDirty] = useState(false);

  // Clear history confirm
  const [confirmClear, setConfirmClear] = useState(false);

  // Interrupt/exit words
  const [interruptWordsInput, setInterruptWordsInput] = useState('');
  const [exitWordsInput, setExitWordsInput] = useState('');

  // Load memory and words on open
  useEffect(() => {
    if (isOpen) {
      setHotkeyDisplay(store.globalHotkey);
      setInterruptWordsInput(store.echoInterruptWords.join(', '));
      setExitWordsInput(store.echoExitWords.join(', '));
      setConfirmClear(false);

      api?.readMemory?.().then((data: { memory: string; user: string }) => {
        if (data) {
          setMemoryContent(data.memory || '');
          setUserContent(data.user || '');
          setMemoryDirty(false);
        }
      });
    }
  }, [isOpen]);

  const handleHotkeyKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isRecordingHotkey) return;
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const key = e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key);
      const hotkey = parts.join('+');
      setHotkeyDisplay(hotkey);
      store.setGlobalHotkey(hotkey);
      setIsRecordingHotkey(false);
    }
  }, [isRecordingHotkey, store]);

  const handleSaveMemory = useCallback(() => {
    api?.saveMemory?.({ memory: memoryContent, user: userContent });
    setMemoryDirty(false);
  }, [memoryContent, userContent]);

  const handleClearHistory = useCallback(() => {
    if (confirmClear) {
      api?.clearAllSessions?.();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  }, [confirmClear]);

  const handleInterruptWordsBlur = useCallback(() => {
    const words = interruptWordsInput.split(',').map(w => w.trim()).filter(Boolean);
    store.setEchoInterruptWords(words);
  }, [interruptWordsInput, store]);

  const handleExitWordsBlur = useCallback(() => {
    const words = exitWordsInput.split(',').map(w => w.trim()).filter(Boolean);
    store.setEchoExitWords(words);
  }, [exitWordsInput, store]);

  if (!isOpen) return null;

  const activeDef = SECTIONS.find(s => s.id === activeSection);

  return (
    <>
      <div className="settings-overlay" onClick={onClose} />
      <div className="settings-panel">
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            <div className="settings-nav-mark" aria-hidden="true">
              <Settings size={16} />
            </div>
            <div className="settings-nav-sections">
            {SECTIONS.map(section => (
              <button
                key={section.id}
                className={`settings-nav-item${activeSection === section.id ? ' active' : ''}`}
                onClick={() => setActiveSection(section.id)}
                title={`${section.label} — ${section.description}`}
                aria-label={section.label}
                aria-current={activeSection === section.id ? 'page' : undefined}
              >
                <span className="settings-tab-icon">{section.icon}</span>
              </button>
            ))}
            </div>
          </nav>

          <div className="settings-content">
            <header className="settings-content-header">
              <div className="settings-content-heading">
                <span className="settings-content-kicker">HERMES SETTINGS</span>
                <h2 className="settings-content-title">{activeDef?.label}</h2>
                <span className="settings-content-subtitle">{activeDef?.description}</span>
              </div>
              <button className="settings-tab-close" onClick={onClose} title="Close settings" aria-label="Close settings">
                <X size={16} />
              </button>
            </header>

            <div className="settings-content-body">
              {activeSection === 'general' && (
                <GeneralSection
                  store={store}
                  api={api}
                  isRecordingHotkey={isRecordingHotkey}
                  setIsRecordingHotkey={setIsRecordingHotkey}
                  hotkeyDisplay={hotkeyDisplay}
                  handleHotkeyKeyDown={handleHotkeyKeyDown}
                />
              )}
              {activeSection === 'appearance' && (
                <AppearanceSection store={store} />
              )}
              {activeSection === 'ai-engine' && (
                <AIEngineSection store={store} />
              )}
              {activeSection === 'voice' && (
                <VoiceSection
                  store={store}
                  interruptWordsInput={interruptWordsInput}
                  setInterruptWordsInput={setInterruptWordsInput}
                  exitWordsInput={exitWordsInput}
                  setExitWordsInput={setExitWordsInput}
                  handleInterruptWordsBlur={handleInterruptWordsBlur}
                  handleExitWordsBlur={handleExitWordsBlur}
                />
              )}
              {activeSection === 'memory' && (
                <MemorySection
                  api={api}
                  memoryContent={memoryContent}
                  setMemoryContent={setMemoryContent}
                  userContent={userContent}
                  setUserContent={setUserContent}
                  memoryDirty={memoryDirty}
                  setMemoryDirty={setMemoryDirty}
                  handleSaveMemory={handleSaveMemory}
                />
              )}
              {activeSection === 'data' && (
                <DataSection
                  api={api}
                  confirmClear={confirmClear}
                  handleClearHistory={handleClearHistory}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// ─── Reusable Section Components ───

interface SectionProps {
  store: any;
  api?: any;
}

const SectionCard: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({
  title, children, className = ''
}) => (
  <div className={`settings-vscode-card ${className}`}>
    {title && <div className="settings-vscode-card-title">{title}</div>}
    {children}
  </div>
);

const SettingRow: React.FC<{
  label: string;
  description?: string;
  children: React.ReactNode;
  vertical?: boolean;
}> = ({ label, description, children, vertical }) => (
  <div className={`settings-vscode-row${vertical ? ' vertical' : ''}`}>
    <div className="settings-vscode-row-label">
      <span>{label}</span>
      {description && <span className="settings-vscode-row-desc">{description}</span>}
    </div>
    <div className="settings-vscode-row-control">{children}</div>
  </div>
);

// ─── General Section ───

const GeneralSection: React.FC<any> = ({
  store, api, isRecordingHotkey, setIsRecordingHotkey,
  hotkeyDisplay, handleHotkeyKeyDown
}) => (
  <div className="settings-section-content">
    <SectionCard title="Window">
      <SettingRow label="Always on top" description="Keep window above others">
        <button
          className={`toggle${store.alwaysOnTop ? ' active' : ''}`}
          onClick={() => store.setAlwaysOnTop(!store.alwaysOnTop)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
      <SettingRow label="Compact mode" description="Smaller window size">
        <button
          className={`toggle${store.smallWindow ? ' active' : ''}`}
          onClick={() => store.setSmallWindow(!store.smallWindow)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
      <SettingRow label="Launch at startup" description="Start with system">
        <button
          className={`toggle${store.launchAtStartup ? ' active' : ''}`}
          onClick={() => store.setLaunchAtStartup(!store.launchAtStartup)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
      <SettingRow label="Auto-capture context" description="Capture screen when summoned">
        <button
          className={`toggle${store.autoCaptureContext ? ' active' : ''}`}
          onClick={() => store.setAutoCaptureContext(!store.autoCaptureContext)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
    </SectionCard>

    <SectionCard title="Hotkey">
      <SettingRow label="Trigger hotkey" description="Global keyboard shortcut to summon">
        <button
          className={`hotkey-recorder${isRecordingHotkey ? ' recording' : ''}`}
          onClick={() => setIsRecordingHotkey(!isRecordingHotkey)}
          onKeyDown={handleHotkeyKeyDown}
          tabIndex={0}
        >
          <Keyboard style={{ width: 12, height: 12 }} />
          {isRecordingHotkey ? 'Press keys...' : hotkeyDisplay}
        </button>
      </SettingRow>
      <SettingRow label="Reset window position" description="Restore default bounds">
        <button className="btn btn-sm" onClick={() => api?.resetBounds?.()}>
          <RotateCw style={{ width: 12, height: 12 }} />
          Reset
        </button>
      </SettingRow>
    </SectionCard>
  </div>
);

// ─── Appearance Section ───

const AppearanceSection: React.FC<SectionProps> = ({ store }) => (
  <div className="settings-section-content">
    <SectionCard title="Theme">
      <SettingRow label="Color theme">
        <div className="theme-picker">
          {(['system', 'dark', 'light'] as const).map(t => (
            <button
              key={t}
              className={`theme-option${store.theme === t ? ' active' : ''}`}
              onClick={() => store.setTheme(t)}
            >
              {t === 'system' && <Monitor size={14} />}
              {(t === 'dark' || t === 'light') && <Sun size={14} />}
              <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
              {store.theme === t && <Check size={12} />}
            </button>
          ))}
        </div>
      </SettingRow>
    </SectionCard>

    <SectionCard title="Accent Color">
      <SettingRow label="Choose accent">
        <div className="color-swatches">
          {ACCENT_COLORS.map(c => (
            <button
              key={c.id}
              className={`color-swatch${store.accentColor === c.id ? ' active' : ''}`}
              style={{ background: c.color }}
              onClick={() => store.setAccentColor(c.id)}
              title={c.label}
            />
          ))}
        </div>
      </SettingRow>
    </SectionCard>

    <SectionCard title="Typography">
      <SettingRow label="Font family">
        <select
          className="select"
          value={store.fontFamily}
          onChange={e => store.setFontFamily(e.target.value)}
        >
          {FONTS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </SettingRow>
    </SectionCard>
  </div>
);

// ─── AI Engine Section ───

const AIEngineSection: React.FC<SectionProps> = ({ store }) => (
  <div className="settings-section-content">
    <SectionCard title="Provider & Model" className="no-padding">
      <ProviderSettings />
    </SectionCard>

    <SectionCard title="Tool Mode">
      <SettingRow label="Default tool mode" description="Which tools the AI can use">
        <div className="segmented-control">
          {(['all', 'terminal', 'none'] as const).map(mode => (
            <button
              key={mode}
              className={`segmented-control-item${store.toolMode === mode ? ' active' : ''}`}
              onClick={() => store.setToolMode(mode)}
            >
              {mode === 'all' && <Zap size={12} />}
              {mode === 'terminal' && <Terminal size={12} />}
              {mode === 'none' && <MessageSquare size={12} />}
              {mode === 'all' ? 'All Tools' : mode === 'terminal' ? 'Terminal' : 'Chat'}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Local mode" description="Use local models only">
        <button
          className={`toggle${store.localMode ? ' active' : ''}`}
          onClick={() => store.setLocalMode(!store.localMode)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
    </SectionCard>
  </div>
);

// ─── Voice Section ───

const VoiceSection: React.FC<any> = ({
  store, interruptWordsInput, setInterruptWordsInput,
  exitWordsInput, setExitWordsInput,
  handleInterruptWordsBlur, handleExitWordsBlur
}) => (
  <div className="settings-section-content">
    <SectionCard title="Speech Detection">
      <SettingRow label="Double-clap to wake" description="Wake voice mode with clap">
        <button
          className={`toggle${store.echoClapWakeEnabled ? ' active' : ''}`}
          onClick={() => store.setEchoClapWakeEnabled(!store.echoClapWakeEnabled)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
      <SettingRow label="Wake word" description="Say a phrase to activate">
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className={`toggle${store.echoWakeWordEnabled ? ' active' : ''}`}
            onClick={() => store.setEchoWakeWordEnabled(!store.echoWakeWordEnabled)}
          >
            <span className="toggle-knob" />
          </button>
          {store.echoWakeWordEnabled && (
            <input
              className="setting-input"
              style={{ width: 120 }}
              value={store.echoWakeWord}
              onChange={e => store.setEchoWakeWord(e.target.value)}
              placeholder="hey hermes"
            />
          )}
        </div>
      </SettingRow>
      <SettingRow label="Double-clap to minimize" description="Minimize with second clap">
        <button
          className={`toggle${store.echoDoubleClapMinimize ? ' active' : ''}`}
          onClick={() => store.setEchoDoubleClapMinimize(!store.echoDoubleClapMinimize)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
      <SettingRow label="Clap sensitivity" vertical>
        <div className="slider-wrapper" style={{ width: '100%' }}>
          <input
            type="range"
            className="slider"
            min="0.1"
            max="1"
            step="0.05"
            value={store.echoClapSensitivity}
            onChange={e => store.setEchoClapSensitivity(parseFloat(e.target.value))}
          />
          <span className="slider-value">{store.echoClapSensitivity.toFixed(2)}</span>
        </div>
      </SettingRow>
    </SectionCard>

    <SectionCard title="Text-to-Speech">
      <SettingRow label="TTS provider">
        <select
          className="select"
          value={store.echoTtsProvider}
          onChange={e => store.setEchoTtsProvider(e.target.value)}
        >
          <option value="system">System voice (instant)</option>
          <option value="hermes">Hermes default</option>
          <option value="edge-tts">Edge TTS</option>
          <option value="openai">OpenAI</option>
          <option value="elevenlabs">ElevenLabs</option>
          <option value="qwen3">Qwen3</option>
        </select>
      </SettingRow>
      {store.echoTtsProvider === 'system' ? (
        <SettingRow label="Voice" description="Local speech starts immediately without network synthesis.">
          <span className="setting-hint">Automatic natural voice</span>
        </SettingRow>
      ) : store.echoTtsProvider === 'hermes' ? (
        <SettingRow label="Voice" description="Uses the provider and voice configured in Hermes.">
          <span className="setting-hint">No Echo override</span>
        </SettingRow>
      ) : store.echoTtsProvider === 'edge-tts' ? (
        <SettingRow label="Voice" vertical>
          <div className="voice-picker">
            {EDGE_TTS_VOICES.map(v => (
              <button
                key={v.id}
                className={`voice-option${store.echoTtsVoice === v.id ? ' active' : ''}`}
                onClick={() => store.setEchoTtsVoice(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </SettingRow>
      ) : (
        <SettingRow label="Voice ID">
          <input
            className="setting-input"
            style={{ width: 160 }}
            value={store.echoTtsVoice}
            onChange={e => store.setEchoTtsVoice(e.target.value)}
            placeholder="Voice ID"
          />
        </SettingRow>
      )}
      <SettingRow label="Voice always-on" description="Continuous listening mode">
        <button
          className={`toggle${store.echoVoiceModeEnabled ? ' active' : ''}`}
          onClick={() => store.setEchoVoiceModeEnabled(!store.echoVoiceModeEnabled)}
        >
          <span className="toggle-knob" />
        </button>
      </SettingRow>
    </SectionCard>

    <SectionCard title="Voice Commands">
      <SettingRow label="Interrupt words" description="Stop speaking when heard" vertical>
        <input
          className="setting-input"
          value={interruptWordsInput}
          onChange={e => setInterruptWordsInput(e.target.value)}
          onBlur={handleInterruptWordsBlur}
          placeholder="stop, wait, shut up"
        />
      </SettingRow>
      <SettingRow label="Exit words" description="End voice session" vertical>
        <input
          className="setting-input"
          value={exitWordsInput}
          onChange={e => setExitWordsInput(e.target.value)}
          onBlur={handleExitWordsBlur}
          placeholder="goodbye, close, exit"
        />
      </SettingRow>
    </SectionCard>
  </div>
);

// ─── Memory Section ───

const MemorySection: React.FC<any> = ({
  api, memoryContent, setMemoryContent, userContent, setUserContent,
  memoryDirty, setMemoryDirty, handleSaveMemory
}) => (
  <div className="settings-section-content">
    <SectionCard title="Agent Memory (MEMORY.md)" className="memory-card">
      <div className="memory-editor">
        <textarea
          className="settings-textarea"
          value={memoryContent}
          onChange={e => { setMemoryContent(e.target.value); setMemoryDirty(true); }}
          placeholder="Agent persistent memory — stored in MEMORY.md..."
          rows={8}
        />
        <div className="memory-toolbar">
          <button
            className="btn btn-sm"
            onClick={() => api?.readMemory?.().then((d: any) => {
              setMemoryContent(d?.memory || '');
              setMemoryDirty(false);
            })}
            title="Reload from disk"
          >
            <RotateCw style={{ width: 12, height: 12 }} />
            Reload
          </button>
          {memoryDirty && (
            <button className="btn btn-primary btn-sm" onClick={handleSaveMemory}>
              <Check style={{ width: 12, height: 12 }} />
              Save Memory
            </button>
          )}
        </div>
      </div>
    </SectionCard>

    <SectionCard title="User Profile (USER.md)" className="memory-card">
      <div className="memory-editor">
        <textarea
          className="settings-textarea"
          value={userContent}
          onChange={e => { setUserContent(e.target.value); setMemoryDirty(true); }}
          placeholder="User profile info — stored in USER.md..."
          rows={5}
        />
      </div>
    </SectionCard>
  </div>
);

// ─── Data Section ───

const DataSection: React.FC<any> = ({ api, confirmClear, handleClearHistory }) => (
  <div className="settings-section-content">
    <SectionCard title="Danger Zone">
      <SettingRow
        label="Clear all sessions"
        description="Permanently delete all chat history"
      >
        <button
          className={`btn btn-sm ${confirmClear ? 'btn-danger-confirm' : 'btn-danger'}`}
          onClick={handleClearHistory}
        >
          <Trash2 style={{ width: 12, height: 12 }} />
          {confirmClear ? 'Confirm delete?' : 'Clear history'}
        </button>
      </SettingRow>
    </SectionCard>
  </div>
);
