import React from 'react';
import { Check } from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';
import { Toggle } from '../ui/Toggle';
import { Slider } from '../ui/Slider';

const EDGE_VOICES = [
  { id: 'en-US-AriaNeural', name: 'Aria', accent: 'US Female' },
  { id: 'en-US-GuyNeural', name: 'Guy', accent: 'US Male' },
  { id: 'en-US-JennyNeural', name: 'Jenny', accent: 'US Female' },
  { id: 'en-US-ChristopherNeural', name: 'Christopher', accent: 'US Male' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', accent: 'UK Female' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', accent: 'UK Male' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha', accent: 'AU Female' },
  { id: 'en-AU-WilliamNeural', name: 'William', accent: 'AU Male' },
];

export const EchoSettings: React.FC = () => {
  const {
    echoClapWakeEnabled, setEchoClapWakeEnabled,
    echoWakeWordEnabled, setEchoWakeWordEnabled,
    echoWakeWord, setEchoWakeWord,
    echoDoubleClapMinimize, setEchoDoubleClapMinimize,
    echoVoiceModeEnabled, setEchoVoiceModeEnabled,
    echoClapSensitivity, setEchoClapSensitivity,
    echoInterruptWords, setEchoInterruptWords,
    echoExitWords, setEchoExitWords,
    echoTtsProvider, setEchoTtsProvider,
    echoTtsVoice, setEchoTtsVoice
  } = useOverlayStore();

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Echo Mode Settings</h3>
        <span style={{ fontSize: 10, color: '#a78bfa', background: 'rgba(167, 139, 250, 0.1)', padding: '2px 8px', borderRadius: 4 }}>BETA</span>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <span>Double-Clap to Wake</span>
          <span className="settings-desc">Activate Echo Mode when you double-clap near your microphone.</span>
        </div>
        <Toggle checked={echoClapWakeEnabled} onChange={setEchoClapWakeEnabled} />
      </div>
      <div className="settings-divider" />
      <div className="settings-row">
        <div className="settings-label">
          <span>Wake Word</span>
          <span className="settings-desc">Activate Echo Mode when you say a specific word or phrase.</span>
        </div>
        <Toggle checked={echoWakeWordEnabled} onChange={setEchoWakeWordEnabled} />
      </div>
      {echoWakeWordEnabled && (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <div className="settings-label" style={{ marginBottom: 8 }}>
            <span>Wake Phrase</span>
            <span className="settings-desc">The phrase to listen for (e.g. "hey hermes"). Needs internet.</span>
          </div>
          <input
            type="text"
            className="mac-input"
            style={{ width: '100%' }}
            value={echoWakeWord}
            onChange={(e) => setEchoWakeWord(e.target.value)}
          />
        </div>
      )}
      <div className="settings-divider" />
      <div className="settings-row">
        <div className="settings-label">
          <span>Double-Clap to Minimize</span>
          <span className="settings-desc">Minimize the overlay instead of ignoring if you double clap while it's open.</span>
        </div>
        <Toggle checked={echoDoubleClapMinimize} onChange={setEchoDoubleClapMinimize} />
      </div>
      <div className="settings-divider" />
      <div className="settings-row">
        <div className="settings-label">
          <span>Voice Mode</span>
          <span className="settings-desc">Keep wake word listener always-on for instant "hey hermes" voice activation. Enables background mic listening.</span>
        </div>
        <Toggle checked={echoVoiceModeEnabled} onChange={setEchoVoiceModeEnabled} />
      </div>
      <div className="settings-divider" />
      <div className="settings-row">
        <div className="settings-label">
          <span>Clap Sensitivity</span>
          <span className="settings-desc">Adjust detection threshold (lower = more sensitive).</span>
        </div>
        <div style={{ width: 150 }}>
          <Slider
            value={echoClapSensitivity}
            onChange={setEchoClapSensitivity}
            min={0.1}
            max={1.0}
            step={0.1}
            showValue
            valueFormatter={(v) => v.toFixed(1)}
          />
        </div>
      </div>
      <div className="settings-divider" />
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <div className="settings-label" style={{ marginBottom: 8 }}>
          <span>Interrupt Words</span>
          <span className="settings-desc">Words that will stop Hermes from speaking (comma separated).</span>
        </div>
        <input
          type="text"
          className="mac-input"
          style={{ width: '100%' }}
          value={echoInterruptWords.join(', ')}
          onChange={(e) => setEchoInterruptWords(e.target.value.split(',').map(s => s.trim()))}
        />
      </div>
      <div className="settings-divider" />
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <div className="settings-label" style={{ marginBottom: 8 }}>
          <span>Exit Words</span>
          <span className="settings-desc">Words that will exit Echo Mode completely (comma separated).</span>
        </div>
        <input
          type="text"
          className="mac-input"
          style={{ width: '100%' }}
          value={echoExitWords.join(', ')}
          onChange={(e) => setEchoExitWords(e.target.value.split(',').map(s => s.trim()))}
        />
      </div>
      <div className="settings-divider" />
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <div className="settings-label" style={{ marginBottom: 8 }}>
          <span>TTS Provider</span>
          <span className="settings-desc">Choose which service generates voice responses.</span>
        </div>
        <select
          className="mac-select"
          style={{ width: '100%', cursor: 'pointer' }}
          value={echoTtsProvider}
          onChange={(e) => setEchoTtsProvider(e.target.value as any)}
        >
          <option value="system">System voice (instant, local)</option>
          <option value="hermes">Hermes default voice</option>
          <option value="edge-tts">Edge TTS (Free, Microsoft voices)</option>
          <option value="openai">OpenAI TTS (High quality)</option>
          <option value="elevenlabs">ElevenLabs (Most natural)</option>
          <option value="qwen3">Qwen 3 TTS (DashScope API)</option>
        </select>
      </div>
      <div className="settings-divider" />
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <div className="settings-label" style={{ marginBottom: 12 }}>
          <span>TTS Voice</span>
          <span className="settings-desc">Select a curated natural voice for Hermes.</span>
        </div>

        {echoTtsProvider === 'system' ? (
          <span className="settings-desc">Speaks locally as soon as a sentence is ready. No network synthesis delay.</span>
        ) : echoTtsProvider === 'hermes' ? (
          <span className="settings-desc">Uses the TTS provider and voice configured in Hermes.</span>
        ) : echoTtsProvider === 'edge-tts' ? (
          <div className="voice-picker-list">
            {EDGE_VOICES.map((voice) => (
              <button
                key={voice.id}
                className={`voice-picker-item ${echoTtsVoice === voice.id ? 'active' : ''}`}
                onClick={() => setEchoTtsVoice(voice.id)}
              >
                <div className="voice-picker-info">
                  <span className="voice-name">{voice.name}</span>
                  <span className="voice-accent">{voice.accent}</span>
                </div>
                {echoTtsVoice === voice.id && <Check size={16} className="voice-check" />}
              </button>
            ))}
          </div>
        ) : (
          <input
            type="text"
            className="mac-input"
            style={{ width: '100%' }}
            value={echoTtsVoice}
            onChange={(e) => setEchoTtsVoice(e.target.value)}
            placeholder="e.g., en-US-AriaNeural"
          />
        )}
      </div>
    </div>
  );
};
