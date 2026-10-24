import React, { useState, useEffect, useRef } from 'react';
import { Brain, Save, RotateCw } from 'lucide-react';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

export const MemorySettings: React.FC = () => {
  const [memoryContent, setMemoryContent] = useState('');
  const [userContent, setUserContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    if (!api?.readMemory) {
      setError('Memory API not available');
      setLoading(false);
      return;
    }

    setLoading(true);
    api.readMemory().then((result) => {
      if (result?.error) {
        setError(result.error);
      } else {
        setMemoryContent(result.memory || '');
        setUserContent(result.user || '');
      }
      setLoading(false);
    }).catch((e) => {
      setError(String(e));
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!api?.saveMemory) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveMemory({ memory: memoryContent, user: userContent });
      if (result?.error) {
        setError(result.error);
      } else {
        setDirty(false);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReload = async () => {
    if (!api?.readMemory) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.readMemory();
      if (result?.error) {
        setError(result.error);
      } else {
        setMemoryContent(result.memory || '');
        setUserContent(result.user || '');
        setDirty(false);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-section">
        <div className="settings-loading">
          <RotateCw size={20} className="spin" />
          <span>Loading memory...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <div className="settings-info-banner">
        <Brain size={14} />
        <span>
          These files persist your preferences and facts across all Hermes sessions.
          MEMORY.md stores agent notes (environment, tools, conventions).
          USER.md stores your profile (name, preferences, communication style).
        </span>
      </div>

      {error && (
        <div className="settings-error-banner">
          Error: {error}
        </div>
      )}

      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div className="settings-label">
          <span>MEMORY.md</span>
          <span className="settings-desc">Agent memory — environment facts, tool quirks, project conventions.</span>
        </div>
        <textarea
          className="memory-textarea"
          value={memoryContent}
          onChange={(e) => { setMemoryContent(e.target.value); setDirty(true); }}
          placeholder="No memory entries yet. Ask Hermes to 'remember this' during a conversation, or edit here manually."
          spellCheck={false}
          rows={10}
        />
      </div>

      <div className="settings-divider" />

      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div className="settings-label">
          <span>USER.md</span>
          <span className="settings-desc">User profile — your name, role, preferences, communication style.</span>
        </div>
        <textarea
          className="memory-textarea"
          value={userContent}
          onChange={(e) => { setUserContent(e.target.value); setDirty(true); }}
          placeholder="No user profile yet. Tell Hermes about yourself, or edit here manually."
          spellCheck={false}
          rows={8}
        />
      </div>

      <div className="settings-divider" />

      <div className="settings-row">
        <div className="settings-label">
          <span>{savedFlash ? 'Saved!' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <span className="settings-desc">
            {savedFlash ? 'Memory files updated.' : dirty ? 'Click Save to persist changes.' : 'Memory is in sync.'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="mac-button" onClick={handleReload} disabled={saving}>
            <RotateCw size={12} style={{ marginRight: 6 }} />
            Reload
          </button>
          <button className="mac-button primary" onClick={handleSave} disabled={!dirty || saving}>
            <Save size={12} style={{ marginRight: 6 }} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div className="settings-label">
          <span>External Memory Providers</span>
          <span className="settings-desc">
            Hermes supports external semantic memory providers (mem0, honcho, hindsight, etc.)
            for vector-based recall of past conversations.
          </span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-disabled)', marginTop: '4px' }}>
          To configure, run: <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>hermes memory setup</code>
        </div>
      </div>
    </div>
  );
};
