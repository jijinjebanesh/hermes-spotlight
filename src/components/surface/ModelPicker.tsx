import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw, Search, ChevronRight, Check, AlertTriangle,
  Loader2, KeyRound, Zap, X,
} from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';
import type { InventoryProvider } from '../../store/overlayStore';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

interface ModelPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Ref to the anchor element for positioning */
  anchorRef?: React.RefObject<HTMLElement>;
}

/**
 * ModelPicker — Quick-access provider/model selector popover.
 *
 * Anchored to the model indicator in the ContextBar. Mirrors
 * `hermes model` in the overlay with zero Settings navigation:
 *   - Live inventory (cached; refresh = --refresh)
 *   - Auth-state badges
 *   - Filterable provider list + searchable model list
 *   - Apply via canonical Hermes config-write path (set_model.py)
 *   - "Configure auth" CTA for OAuth providers
 *   - Keyboard nav: Escape to close, Enter to apply
 */
export const ModelPicker: React.FC<ModelPickerProps> = ({ isOpen, onClose }) => {
  const {
    activeProvider, setActiveProvider,
    activeModel, setActiveModel,
    inventory, setInventory,
    inventoryLoading, setInventoryLoading,
  } = useOverlayStore();

  const [selectedProvider, setSelectedProvider] = useState<string>(activeProvider || '');
  const [providerFilter, setProviderFilter] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const modelSearchRef = useRef<HTMLInputElement>(null);
  const providerFilterRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync selected provider with active on open
  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(activeProvider || '');
      setProviderFilter('');
      setModelSearch('');
      setApplyResult(null);
      // Focus provider filter on open
      setTimeout(() => providerFilterRef.current?.focus(), 60);
    }
  }, [isOpen, activeProvider]);

  // Auto-select active provider if none chosen
  useEffect(() => {
    if (!selectedProvider && activeProvider) setSelectedProvider(activeProvider);
    if (!selectedProvider && !activeProvider && inventory.length) {
      const cur = inventory.find(p => p.is_current);
      if (cur) setSelectedProvider(cur.slug);
    }
  }, [activeProvider, selectedProvider, inventory]);

  // Click-outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately on the same click that opened it
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [isOpen, onClose]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isOpen, onClose]);

  const selectedData = useMemo<InventoryProvider | undefined>(
    () => inventory.find(p => p.slug === selectedProvider),
    [inventory, selectedProvider]
  );

  // Filtered providers (group: configured first, then needs-config)
  const filtered = useMemo(() => {
    const q = providerFilter.trim().toLowerCase();
    const list = q
      ? inventory.filter(p =>
          p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
      : inventory;
    const configured = list.filter(p => p.authenticated && p.total_models > 0);
    const available = list.filter(p => !(p.authenticated && p.total_models > 0));
    return { configured, available };
  }, [inventory, providerFilter]);

  const models = selectedData?.models || [];
  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m => m.toLowerCase().includes(q));
  }, [models, modelSearch]);
  const hasExactModel = filteredModels.some(
    m => m.toLowerCase() === modelSearch.trim().toLowerCase()
  );

  // Auth-type → human label
  const authLabel = (p: InventoryProvider): string => {
    if (p.authenticated && p.total_models > 0) return 'Configured';
    if (!p.auth_type) return 'No auth needed';
    if (p.auth_type === 'api_key') return p.key_env ? `Needs ${p.key_env}` : 'Needs API key';
    if (p.auth_type === 'oauth_device_code') return 'OAuth (device code)';
    if (p.auth_type === 'oauth_external') return 'OAuth (browser)';
    if (p.auth_type === 'oauth_minimax') return 'OAuth (MiniMax)';
    if (p.auth_type === 'external_process') return 'External CLI';
    if (p.auth_type === 'aws_sdk') return 'AWS SDK creds';
    if (p.auth_type === 'virtual') return 'Aggregator';
    return p.auth_type;
  };

  // Can this provider be configured/re-configured via `hermes auth`?
  const canAuth = (p: InventoryProvider): boolean => {
    if (p.auth_type === 'virtual' || p.auth_type === 'none') return false;
    // Show auth if it has an auth_type, a key_env, or is currently authenticated
    return !!p.auth_type || !!p.key_env || p.authenticated;
  };

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
      console.error('inventory refresh failed', e);
    } finally {
      setRefreshing(false);
      setInventoryLoading(false);
    }
  }, [setInventory, setInventoryLoading, setActiveProvider, setActiveModel]);

  const handleSelectProvider = useCallback((slug: string) => {
    setSelectedProvider(slug);
    setModelSearch('');
    setTimeout(() => modelSearchRef.current?.focus(), 50);
  }, []);

  const handleApply = useCallback(async (provider: string, model: string) => {
    if (!provider || !model) return;
    setApplying(true);
    setApplyResult(null);
    try {
      if (api?.applyProviderModel) {
        const res = await api.applyProviderModel(provider, model);
        if (res?.success) {
          setActiveProvider(res.provider || provider);
          setActiveModel(res.model || model);
          setApplyResult({ ok: true, msg: `${res.provider || provider} / ${res.model || model}` });
          // Auto-close after successful apply
          setTimeout(() => onClose(), 1200);
        } else {
          setApplyResult({ ok: false, msg: res?.error || 'Unknown error' });
        }
      } else if (api?.setProviderAndModel) {
        api.setProviderAndModel(provider, model);
        setActiveProvider(provider);
        setActiveModel(model);
        setApplyResult({ ok: true, msg: `${provider} / ${model}` });
        setTimeout(() => onClose(), 1200);
      } else {
        setApplyResult({ ok: false, msg: 'No apply API available' });
      }
    } catch (e: any) {
      setApplyResult({ ok: false, msg: e?.message || String(e) });
    } finally {
      setApplying(false);
      setTimeout(() => setApplyResult(null), 4000);
    }
  }, [setActiveProvider, setActiveModel, onClose]);

  const handleLaunchAuth = useCallback(async (provider: string) => {
    if (!api?.launchHermesAuth) return;
    const res = await api.launchHermesAuth(provider);
    if (!res?.success) {
      setApplyResult({ ok: false, msg: res?.error || 'Failed to launch auth' });
    } else {
      setApplyResult({ ok: true, msg: `Opened terminal for ${provider} auth — complete the flow, then Refresh.` });
    }
    setTimeout(() => setApplyResult(null), 6000);
  }, []);

  if (!isOpen) return null;

  const isEmpty = inventory.length === 0 && !inventoryLoading;

  return (
    <div className="model-picker-popover" ref={panelRef}>
      {/* Header */}
      <div className="model-picker-header">
        <div className="model-picker-title">
          <Zap size={13} />
          <span>Model Configuration</span>
        </div>
        <div className="model-picker-header-actions">
          <button
            className="model-picker-icon-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh inventory (re-fetch live models)"
          >
            {refreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          </button>
          <button
            className="model-picker-icon-btn"
            onClick={onClose}
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="model-picker-empty">
          <div className="model-picker-empty-text">
            No providers found. Make sure Hermes is installed.
          </div>
          <button className="btn btn-sm" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            Refresh inventory
          </button>
        </div>
      )}

      {/* Loading state */}
      {inventoryLoading && inventory.length === 0 && (
        <div className="model-picker-empty">
          <Loader2 size={16} className="spin" />
          <span>Loading providers…</span>
        </div>
      )}

      {/* Main grid */}
      {inventory.length > 0 && (
        <div className="model-picker-grid">
          {/* Provider column */}
          <div className="model-picker-col">
            <div className="model-picker-col-label">
              <Zap size={10} /> Providers
            </div>
            <div className="model-picker-search">
              <Search size={11} className="model-picker-search-icon" />
              <input
                ref={providerFilterRef}
                type="text"
                placeholder="Filter…"
                value={providerFilter}
                onChange={e => setProviderFilter(e.target.value)}
              />
            </div>
            <div className="model-picker-list">
              {filtered.configured.length > 0 && (
                <>
                  <div className="model-picker-group">Configured</div>
                  {filtered.configured.map(p => (
                    <button
                      key={p.slug}
                      className={`model-picker-provider-row${p.slug === selectedProvider ? ' active' : ''}${!p.authenticated ? ' unconfigured' : ''}`}
                      onClick={() => handleSelectProvider(p.slug)}
                    >
                      <span className="model-picker-provider-name">{p.name}</span>
                      <span className="model-picker-provider-meta">
                        {p.total_models > 0 ? `${p.total_models}` : '—'}
                      </span>
                      {p.slug === activeProvider && (
                        <span className="model-picker-provider-active-dot" title="Active" />
                      )}
                    </button>
                  ))}
                </>
              )}
              {filtered.available.length > 0 && (
                <>
                  <div className="model-picker-group">Available</div>
                  {filtered.available.map(p => (
                    <button
                      key={p.slug}
                      className={`model-picker-provider-row${p.slug === selectedProvider ? ' active' : ''}${!p.authenticated ? ' unconfigured' : ''}`}
                      onClick={() => handleSelectProvider(p.slug)}
                    >
                      <span className="model-picker-provider-name">{p.name}</span>
                      <span className="model-picker-provider-meta">
                        {p.total_models > 0 ? `${p.total_models}` : '—'}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Model column */}
          <div className="model-picker-col">
            <div className="model-picker-col-label">
              <ChevronRight size={10} />
              {selectedData ? (
                <>
                  {selectedData.name}
                  <span className="model-picker-model-count">({selectedData.total_models})</span>
                </>
              ) : (
                'Select provider'
              )}
              {selectedData && (
                <span className={`model-picker-auth-badge ${selectedData.authenticated ? 'ok' : 'warn'}`}>
                  {selectedData.authenticated ? <Check size={9} /> : <AlertTriangle size={9} />}
                  {authLabel(selectedData)}
                </span>
              )}
            </div>

            {selectedData?.warning && (
              <div className="model-picker-warning">
                <AlertTriangle size={10} />
                <span>{selectedData.warning}</span>
              </div>
            )}

            <div className="model-picker-search">
              <Search size={11} className="model-picker-search-icon" />
              <input
                ref={modelSearchRef}
                type="text"
                placeholder={models.length ? `Search ${models.length} models…` : 'No models'}
                value={modelSearch}
                onChange={e => setModelSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && selectedData) {
                    const q = modelSearch.trim();
                    if (!q) return;
                    const exact = models.find(m => m.toLowerCase() === q.toLowerCase());
                    handleApply(selectedData.slug, exact || q);
                  }
                }}
                disabled={models.length === 0}
              />
            </div>

            <div className="model-picker-list model-picker-model-list">
              {models.length === 0 ? (
                <div className="model-picker-list-empty">
                  {selectedData
                    ? (canAuth(selectedData) && !selectedData.authenticated
                        ? 'Requires authentication.'
                        : (selectedData.warning || 'No models available.'))
                    : 'Pick a provider on the left.'}
                </div>
              ) : (
                <>
                  {filteredModels.map(m => (
                    <button
                      key={m}
                      className={`model-picker-model-row${m === activeModel && selectedData?.slug === activeProvider ? ' active' : ''}`}
                      onClick={() => selectedData && handleApply(selectedData.slug, m)}
                      disabled={applying}
                    >
                      <span className="model-picker-model-name">{m}</span>
                      {m === activeModel && selectedData?.slug === activeProvider && (
                        <Check size={11} className="model-picker-model-check" />
                      )}
                    </button>
                  ))}
                  {modelSearch.trim() && !hasExactModel && selectedData && (
                    <button
                      className="model-picker-model-row model-picker-model-custom"
                      onClick={() => handleApply(selectedData.slug, modelSearch.trim())}
                      disabled={applying}
                    >
                      <span className="model-picker-model-name">Use "{modelSearch.trim()}"</span>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Actions footer */}
            {selectedData && (
              <div className="model-picker-actions">
                {canAuth(selectedData) && (
                  <button
                    className="btn btn-sm"
                    onClick={() => handleLaunchAuth(selectedData.slug)}
                    title={`Run: hermes auth add ${selectedData.slug}`}
                  >
                    <KeyRound size={11} /> {selectedData.authenticated ? 'Re-auth…' : 'Auth…'}
                  </button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const m = modelSearch.trim() || activeModel;
                    if (m) handleApply(selectedData.slug, m);
                  }}
                  disabled={applying || (!modelSearch.trim() && !activeModel)}
                >
                  {applying ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {applyResult && (
        <div className={`model-picker-toast ${applyResult.ok ? 'ok' : 'err'}`}>
          {applyResult.ok ? <Check size={11} /> : <AlertTriangle size={11} />}
          <span>{applyResult.msg}</span>
        </div>
      )}
    </div>
  );
};
