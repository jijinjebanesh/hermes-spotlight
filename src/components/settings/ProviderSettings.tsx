import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { RefreshCw, Search, Check, Loader2, KeyRound, ChevronDown } from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';
import type { InventoryProvider } from '../../store/overlayStore';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

/**
 * ProviderSettings — Full-width two-panel provider/model picker.
 * Left: Filterable provider list (grouped by status)
 * Right: Model list with search, click to apply immediately
 */
export const ProviderSettings: React.FC = () => {
  const {
    activeProvider, setActiveProvider,
    activeModel, setActiveModel,
    inventory, setInventory,
    inventoryLoading, setInventoryLoading,
  } = useOverlayStore();

  const [selectedProvider, setSelectedProvider] = useState<string>(activeProvider || '');
  const [providerFilter, setProviderFilter] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [applying, setApplying] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-select active provider
  useEffect(() => {
    if (!selectedProvider && activeProvider) {
      setSelectedProvider(activeProvider);
    } else if (!selectedProvider && !activeProvider && inventory.length) {
      const cur = inventory.find(p => p.is_current);
      if (cur) setSelectedProvider(cur.slug);
    }
  }, [activeProvider, selectedProvider, inventory]);

  const selectedData = useMemo<InventoryProvider | undefined>(
    () => inventory.find(p => p.slug === selectedProvider),
    [inventory, selectedProvider]
  );

  // Group providers
  const { configured, needsSetup } = useMemo(() => {
    const q = providerFilter.trim().toLowerCase();
    const list = q
      ? inventory.filter(p =>
          p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
      : inventory;
    return {
      configured: list.filter(p => p.authenticated && p.total_models > 0),
      needsSetup: list.filter(p => !(p.authenticated && p.total_models > 0)),
    };
  }, [inventory, providerFilter]);

  // Filtered models
  const filteredModels = useMemo(() => {
    const models = selectedData?.models || [];
    const q = modelSearch.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m => m.toLowerCase().includes(q));
  }, [selectedData, modelSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  const handleRefresh = useCallback(async () => {
    if (!api?.getInventory) return;
    setRefreshing(true);
    setInventoryLoading(true);
    try {
      const payload = await api.getInventory({ refresh: true });
      if (payload?.providers) {
        setInventory(payload.providers);
        const state = useOverlayStore.getState();
        if (!state.activeProvider && payload.provider) setActiveProvider(payload.provider);
        if (!state.activeModel && payload.model) setActiveModel(payload.model);
      }
    } catch (e) {
      console.error('[ProviderSettings] refresh failed', e);
    } finally {
      setRefreshing(false);
      setInventoryLoading(false);
    }
  }, [api, setInventory, setInventoryLoading, setActiveProvider, setActiveModel]);

  const handleApplyModel = useCallback(async (model: string) => {
    if (!selectedProvider || !model || applying) return;
    setApplying(model);
    try {
      if (api?.applyProviderModel) {
        const res = await api.applyProviderModel(selectedProvider, model);
        if (res?.success) {
          setActiveProvider(res.provider || selectedProvider);
          setActiveModel(res.model || model);
        }
      } else if (api?.setProviderAndModel) {
        api.setProviderAndModel(selectedProvider, model);
        setActiveProvider(selectedProvider);
        setActiveModel(model);
      }
    } catch (e) {
      console.error('[ProviderSettings] apply failed', e);
    } finally {
      setApplying(null);
      setModelDropdownOpen(false);
    }
  }, [selectedProvider, applying, api, setActiveProvider, setActiveModel]);

  const handleSelectProvider = useCallback((slug: string) => {
    setSelectedProvider(slug);
    setModelSearch('');
    setModelDropdownOpen(false);
  }, []);

  const isActiveModel = (model: string) =>
    model === activeModel && selectedProvider === activeProvider;

  // ── Empty state ──
  if (inventory.length === 0 && !inventoryLoading) {
    return (
      <div className="ps-empty">
        <KeyRound size={28} />
        <p>No providers found</p>
        <span>Ensure Hermes CLI is installed, then refresh.</span>
        <button className="ps-btn ps-btn-primary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          Refresh inventory
        </button>
      </div>
    );
  }

  return (
    <div className="ps">
      {/* ── Header with model dropdown ── */}
      <div className="ps-header">
        <div className="ps-model-selector" ref={dropdownRef}>
          <button
            className="ps-model-trigger"
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
          >
            <span className="ps-model-name">{activeModel || 'Select model'}</span>
            <ChevronDown size={14} className={`ps-model-chevron ${modelDropdownOpen ? 'open' : ''}`} />
          </button>

          {modelDropdownOpen && (
            <div className="ps-model-dropdown">
              <div className="ps-model-dropdown-header">
                <span>{selectedData?.name || 'Models'}</span>
                <button className="ps-model-dropdown-search-btn" onClick={e => { e.stopPropagation(); }}>
                  <Search size={12} />
                </button>
              </div>
              <div className="ps-model-dropdown-search">
                <Search size={12} className="ps-model-dropdown-search-icon" />
                <input
                  type="text"
                  placeholder="Search models..."
                  value={modelSearch}
                  onChange={e => setModelSearch(e.target.value)}
                  className="ps-model-dropdown-search-input"
                  autoFocus
                />
              </div>
              <div className="ps-model-dropdown-list">
                {filteredModels.length === 0 ? (
                  <div className="ps-model-dropdown-empty">No models match</div>
                ) : (
                  filteredModels.map(model => (
                    <button
                      key={model}
                      className={`ps-model-dropdown-item${isActiveModel(model) ? ' active' : ''}${applying === model ? ' applying' : ''}`}
                      onClick={() => handleApplyModel(model)}
                      disabled={applying === model}
                    >
                      <span className="ps-model-dropdown-item-name">{model}</span>
                      {isActiveModel(model) && <Check size={12} />}
                      {applying === model && <span className="spinner" />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <button
          className="ps-btn ps-btn-ghost ps-btn-icon"
          onClick={handleRefresh}
          disabled={refreshing || inventoryLoading}
          title="Refresh inventory"
        >
          {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {/* ── Provider filter ── */}
      <div className="ps-filter">
        <Search size={13} className="ps-filter-icon" />
        <input
          type="text"
          placeholder="Filter providers..."
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
          className="ps-filter-input"
          aria-label="Filter providers"
        />
      </div>

      {/* ── Two-panel grid ── */}
      <div className="ps-grid">
        {/* Left: Providers */}
        <div className="ps-panel ps-providers">
          {inventoryLoading && inventory.length === 0 && (
            <div className="ps-loading">
              <Loader2 size={14} className="spin" />
              <span>Loading providers…</span>
            </div>
          )}

          {configured.length > 0 && (
            <div className="ps-group">
              <div className="ps-group-title">Configured</div>
              {configured.map(p => (
                <button
                  key={p.slug}
                  className={`ps-row${selectedProvider === p.slug ? ' selected' : ''}${p.slug === activeProvider ? ' is-active' : ''}`}
                  onClick={() => handleSelectProvider(p.slug)}
                >
                  <span className="ps-row-name">{p.name}</span>
                  <span className="ps-row-count">{p.total_models}</span>
                  {p.slug === activeProvider && <span className="ps-row-badge">Active</span>}
                </button>
              ))}
            </div>
          )}

          {needsSetup.length > 0 && (
            <div className="ps-group">
              <div className="ps-group-title">Needs Setup</div>
              {needsSetup.map(p => (
                <button
                  key={p.slug}
                  className={`ps-row unconfigured${selectedProvider === p.slug ? ' selected' : ''}`}
                  onClick={() => handleSelectProvider(p.slug)}
                >
                  <span className="ps-row-name">{p.name}</span>
                  <span className="ps-row-count">—</span>
                  {p.auth_type === 'api_key' && <KeyRound size={10} className="ps-row-lock" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Models */}
        <div className="ps-panel ps-models">
          {selectedData ? (
            <div className="ps-models-grid">
              {filteredModels.length === 0 ? (
                <div className="ps-models-empty">
                  <span>No models found</span>
                </div>
              ) : (
                filteredModels.map(model => (
                  <button
                    key={model}
                    className={`ps-model-card${isActiveModel(model) ? ' active' : ''}${applying === model ? ' applying' : ''}`}
                    onClick={() => handleApplyModel(model)}
                    disabled={applying === model}
                  >
                    <span className="ps-model-card-name">{model}</span>
                    {isActiveModel(model) && (
                      <span className="ps-model-card-check">
                        <Check size={12} />
                      </span>
                    )}
                    {applying === model && <span className="spinner" />}
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="ps-models-empty">
              <span>Select a provider</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
