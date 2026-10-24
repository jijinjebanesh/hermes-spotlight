import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Zap, Search, Check, Loader2 } from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';
import { Popover } from '../ui/Popover';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

export const ModelSelector: React.FC = () => {
  const {
    activeModel, setActiveModel,
    activeProvider, setActiveProvider,
    inventory, inventoryLoading,
    setInventory, setInventoryLoading
  } = useOverlayStore();

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'providers' | 'models'>('providers');
  const [selectedProvider, setSelectedProvider] = useState<string>(activeProvider);
  const [searchQuery, setSearchQuery] = useState('');
  
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync selected provider when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(activeProvider);
      setView('providers');
      setSearchQuery('');
    }
  }, [isOpen, activeProvider]);

  const handleRefreshInventory = () => {
    if (!api?.getInventory) return;
    setInventoryLoading(true);
    api.getInventory()
      .then((payload: any) => {
        if (payload?.providers) setInventory(payload.providers);
      })
      .catch(() => {})
      .finally(() => setInventoryLoading(false));
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProvider(providerId);
    setView('models');
    setSearchQuery('');
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const handleSelectModel = (model: string) => {
    setActiveModel(model);
    setActiveProvider(selectedProvider);
    setIsOpen(false);
    api?.setProviderAndModel(selectedProvider, model);
  };

  const authenticated = inventory.filter(p => p.authenticated && p.models.length > 0);
  const unconfigured = inventory.filter(p => !p.authenticated || p.models.length === 0);

  const selectedProviderData = inventory.find(p => p.slug === selectedProvider);
  const allModels = selectedProviderData?.models || [];
  const filteredModels = searchQuery.trim()
    ? allModels.filter(m => m.toLowerCase().includes(searchQuery.toLowerCase()))
    : allModels;
  const hasExactMatch = filteredModels.some(m => m.toLowerCase() === searchQuery.toLowerCase());

  const providerData = inventory.find(p => p.slug === activeProvider);
  const providerLabel = providerData?.name || activeProvider || 'Select';
  const modelShort = activeModel
    ? (activeModel.includes('/') ? activeModel.split('/').pop()! : activeModel)
    : 'No model';
  const displayModel = modelShort.length > 18 ? modelShort.substring(0, 18) + '…' : modelShort;

  return (
    <div className="header-no-drag" style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        className={`model-pill ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="model-pill-provider">{providerLabel}</span>
        <span className="model-pill-model">{displayModel}</span>
        {inventoryLoading ? (
          <Loader2 size={10} className="model-pill-chevron spin" />
        ) : (
          <ChevronDown size={10} className={`model-pill-chevron ${isOpen ? 'open' : ''}`} />
        )}
      </button>

      <Popover 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)} 
        triggerRef={triggerRef}
        className="model-popover"
      >
        {view === 'providers' && (
          <>
            <div className="popover-section-label">
              <Zap size={10} />
              <span>Select Provider</span>
              <button
                className="popover-refresh-btn"
                onClick={handleRefreshInventory}
                title="Refresh model list"
              >
                ↻
              </button>
            </div>

            <div className="model-list-scroll">
              {authenticated.length > 0 && (
                <>
                  <div className="popover-group-label">Configured ({authenticated.length})</div>
                  {authenticated.map((p) => (
                    <button
                      key={p.slug}
                      className={`model-popover-item provider-item${p.slug === activeProvider ? ' active' : ''}`}
                      onClick={() => handleSelectProvider(p.slug)}
                      role="option"
                      aria-selected={p.slug === activeProvider}
                    >
                      <span className="provider-item-label">{p.name}</span>
                      <span className="provider-item-models">
                        {p.models.length} model{p.models.length !== 1 ? 's' : ''}
                      </span>
                      {p.slug === activeProvider && <Check size={12} className="provider-check" />}
                    </button>
                  ))}
                </>
              )}

              {unconfigured.length > 0 && (
                <>
                  <div className="popover-group-label">Available ({unconfigured.length})</div>
                  {unconfigured.map((p) => (
                    <button
                      key={p.slug}
                      className="model-popover-item provider-item unconfigured"
                      onClick={() => handleSelectProvider(p.slug)}
                      role="option"
                    >
                      <span className="provider-item-label">{p.name}</span>
                      <span className="provider-item-hint">
                        {p.warning ? p.warning.replace('paste ', '').replace(' to activate', '') : 'no key'}
                      </span>
                    </button>
                  ))}
                </>
              )}

              {inventory.length === 0 && !inventoryLoading && (
                <div className="popover-empty">
                  No providers found. Run<br /><code>hermes model</code> to configure.
                </div>
              )}

              {inventoryLoading && (
                <div className="popover-empty">
                  <Loader2 size={14} className="spin" style={{ display: 'inline-block', marginRight: 6 }} />
                  Loading providers…
                </div>
              )}
            </div>
          </>
        )}

        {view === 'models' && (
          <>
            <button className="popover-back-btn" onClick={() => setView('providers')}>
              ← {selectedProviderData?.name || selectedProvider}
            </button>

            <div className="popover-search-container">
              <Search size={12} className="popover-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="popover-search-input"
                placeholder={`Search ${allModels.length} model${allModels.length !== 1 ? 's' : ''}…`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim() && !hasExactMatch) {
                    handleSelectModel(searchQuery.trim());
                  }
                }}
              />
            </div>

            <div className="model-list-scroll">
              {filteredModels.map((m) => (
                <button
                  key={m}
                  className={`model-popover-item model-item${m === activeModel && selectedProvider === activeProvider ? ' active' : ''}`}
                  onClick={() => handleSelectModel(m)}
                  role="option"
                  aria-selected={m === activeModel}
                >
                  <span className="model-item-name">{m}</span>
                  {m === activeModel && selectedProvider === activeProvider && (
                    <Check size={12} className="provider-check" />
                  )}
                </button>
              ))}

              {searchQuery.trim() && !hasExactMatch && (
                <button
                  className="model-popover-item model-item custom-model"
                  onClick={() => handleSelectModel(searchQuery.trim())}
                  role="option"
                >
                  <span className="model-item-name">Use "{searchQuery.trim()}"</span>
                </button>
              )}

              {allModels.length === 0 && (
                <div className="popover-empty">
                  {selectedProviderData?.warning || 'No models available. Configure the provider first.'}
                </div>
              )}
            </div>
          </>
        )}
      </Popover>
    </div>
  );
};
