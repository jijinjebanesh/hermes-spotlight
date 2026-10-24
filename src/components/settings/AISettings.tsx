import React from 'react';
import { useOverlayStore } from '../../store/overlayStore';
import { Toggle } from '../ui/Toggle';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

export const AISettings: React.FC = () => {
  const {
    toolMode, setToolMode,
    activeProvider, setActiveProvider,
    activeModel, setActiveModel,
    inventory = [],
    localMode, setLocalMode
  } = useOverlayStore();

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const prov = e.target.value;
    setActiveProvider(prov);
    const provData = inventory.find(p => p.slug === prov);
    if (provData && provData.models.length > 0) {
      setActiveModel(provData.models[0]);
      if (api?.setProviderAndModel) api.setProviderAndModel(prov, provData.models[0]);
    }
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const mod = e.target.value;
    setActiveModel(mod);
    if (api?.setProviderAndModel) api.setProviderAndModel(activeProvider, mod);
  };

  const selectedProviderData = inventory.find(p => p.slug === activeProvider);

  return (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-label">
          <span>Provider</span>
          <span className="settings-desc">Select the default AI provider.</span>
        </div>
        <select className="mac-select" value={activeProvider} onChange={handleProviderChange}>
          <option value="">Select Provider...</option>
          {inventory.map(p => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Model</span>
          <span className="settings-desc">Select the default AI model.</span>
        </div>
        <select className="mac-select" value={activeModel} onChange={handleModelChange} disabled={!selectedProviderData || selectedProviderData.models.length === 0}>
          {selectedProviderData?.models.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
          {!selectedProviderData && <option value="">No models</option>}
        </select>
      </div>
      <div className="settings-divider" />
      <div className="settings-row">
        <div className="settings-label">
          <span>Default Tool Mode</span>
          <span className="settings-desc">Which tools the AI can use by default.</span>
        </div>
        <div className="mac-segmented-control">
          <button className={toolMode === 'all' ? 'active' : ''} onClick={() => setToolMode('all')}>All Tools</button>
          <button className={toolMode === 'terminal' ? 'active' : ''} onClick={() => setToolMode('terminal')}>Terminal Only</button>
          <button className={toolMode === 'none' ? 'active' : ''} onClick={() => setToolMode('none')}>None</button>
        </div>
      </div>
      <div className="settings-divider" />
      <div className="settings-row">
        <div className="settings-label">
          <span>Local Mode</span>
          <span className="settings-desc">Prefer local models if available.</span>
        </div>
        <Toggle checked={localMode} onChange={setLocalMode} />
      </div>
    </div>
  );
};
