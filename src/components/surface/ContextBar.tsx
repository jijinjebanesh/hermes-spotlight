import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  MoreHorizontal, Plus, X, Settings, TerminalSquare, Zap,
  Maximize2, Minimize2, ChevronDown, RefreshCw, Check, Loader2
} from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';
import { getElectronAPI } from '../../hooks/useElectronAPI';
import type { InventoryProvider } from '../../store/overlayStore';

const api = getElectronAPI();

interface ContextBarProps {
  onNewSession?: () => void;
  showNewButton?: boolean;
}

/**
 * ContextBar — Model pill with action buttons.
 *
 * Always shows: model name (clickable to change model)
 * On hover: expands to show action buttons
 * Clicking the model name shows a dropdown of models from current provider.
 */
export const ContextBar: React.FC<ContextBarProps> = ({
  onNewSession,
  showNewButton = true,
}) => {
  const {
    activeModel, activeProvider,
    streamState, setSettingsOpen, backgroundTasks, smallWindow, setSmallWindow,
    inventory, setInventory, inventoryLoading, setInventoryLoading,
    setActiveModel, setActiveProvider,
  } = useOverlayStore();

  const isStreaming = streamState.isStreaming;

  const [isHovered, setIsHovered] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLButtonElement[]>([]);

  const runningTasks = backgroundTasks.filter((t: any) => t.status === 'running');
  const hasRunning = runningTasks.length > 0;

  // Get current provider data
  const currentProviderData = useMemo<InventoryProvider | undefined>(() =>
    inventory.find(p => p.slug === activeProvider),
    [inventory, activeProvider]
  );

  // All models from current provider
  const providerModels = useMemo(() => {
    if (!currentProviderData?.models) return [];
    return currentProviderData.models;
  }, [currentProviderData]);

  // Apply model change
  const handleApplyModel = useCallback(async (model: string) => {
    if (!activeProvider || !model || applying) return;
    if (model === activeModel) {
      setModelDropdownOpen(false);
      setKeyboardIndex(-1);
      return;
    }
    setApplying(model);
    try {
      if (api?.applyProviderModel) {
        const res = await api.applyProviderModel(activeProvider, model);
        if (res?.success) {
          setActiveProvider(res.provider || activeProvider);
          setActiveModel(res.model || model);
        }
      } else if (api?.setProviderAndModel) {
        api.setProviderAndModel(activeProvider, model);
        setActiveModel(model);
      }
    } catch (e) {
      console.error('[ContextBar] apply model failed', e);
    } finally {
      setApplying(null);
      setModelDropdownOpen(false);
      setKeyboardIndex(-1);
    }
  }, [activeProvider, activeModel, applying, api, setActiveModel, setActiveProvider]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
        setKeyboardIndex(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: KeyboardEvent) => {
      const items = providerModels.length;
      if (items === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setKeyboardIndex(prev => Math.min(prev + 1, items - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setKeyboardIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (keyboardIndex >= 0 && keyboardIndex < items) {
            handleApplyModel(providerModels[keyboardIndex]);
          }
          break;
        case 'Escape':
          setModelDropdownOpen(false);
          setKeyboardIndex(-1);
          break;
        case 'Home':
          e.preventDefault();
          setKeyboardIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setKeyboardIndex(items - 1);
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modelDropdownOpen, providerModels, keyboardIndex, handleApplyModel]);

  // Scroll selected item into view
  useEffect(() => {
    if (keyboardIndex >= 0 && listRef.current && itemsRef.current[keyboardIndex]) {
      itemsRef.current[keyboardIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [keyboardIndex]);

  const handleClose = () => api?.closeOverlay();
  const handleTerminal = () => api?.openTerminal?.();

  const handleDropdownToggle = useCallback(() => {
    setModelDropdownOpen(prev => {
      const next = !prev;
      if (next) setKeyboardIndex(activeModel ? providerModels.indexOf(activeModel) : 0);
      else setKeyboardIndex(-1);
      return next;
    });
  }, [activeModel, providerModels]);

  return (
    <div className="context-bar context-bar--compact">
      {/* Model pill - always shows model name, expands on hover for actions */}
      <div
        className={`model-pill ${isHovered ? 'expanded' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          if (!modelDropdownOpen) setIsHovered(false);
        }}
      >
        {/* Model selector - always visible */}
        <div className="model-pill-selector" ref={dropdownRef}>
          <button
            className="model-pill-name"
            onClick={handleDropdownToggle}
            title={`Change model (${activeProvider})`}
            aria-haspopup="listbox"
            aria-expanded={modelDropdownOpen}
          >
            <span className={`model-dot-indicator ${isStreaming ? 'streaming' : ''}`} />
            <span className="model-pill-label">{activeModel || 'No model'}</span>
            <ChevronDown size={12} className={`model-pill-chevron ${modelDropdownOpen ? 'open' : ''}`} />
          </button>

          {/* Model dropdown */}
          {modelDropdownOpen && (
            <div className="model-dropdown" role="listbox">
              <div className="model-dropdown-header">
                <span>{activeProvider || 'Select model'}</span>
              </div>
              <div className="model-dropdown-list" ref={listRef}>
                {providerModels.length === 0 ? (
                  <div className="model-dropdown-empty">
                    <span>No models available</span>
                    <button
                      className="model-dropdown-refresh"
                      onClick={async () => {
                        if (api?.getInventory) {
                          const payload = await api.getInventory({ refresh: true });
                          if (payload?.providers) setInventory(payload.providers);
                        }
                      }}
                    >
                      <RefreshCw size={12} /> Refresh
                    </button>
                  </div>
                ) : (
                  providerModels.map((model, idx) => {
                    const isActive = model === activeModel;
                    const isApplying = applying === model;
                    return (
                                          <button
                                            key={model}
                                            ref={el => { if (el) itemsRef.current[idx] = el; }}
                                            className={`model-dropdown-item${isActive ? ' active' : ''}${isApplying ? ' applying' : ''}${keyboardIndex === idx ? ' focused' : ''}`}
                                            onClick={() => handleApplyModel(model)}
                                            onMouseEnter={() => setKeyboardIndex(idx)}
                                            disabled={isApplying}
                                            role="option"
                                            aria-selected={isActive}
                                            aria-current={isActive ? 'true' : undefined}
                                          >
                        <span className="model-dropdown-item-name">{model}</span>
                        {isActive && <Check size={12} className="model-dropdown-item-check" />}
                        {isApplying && <Loader2 size={12} className="model-dropdown-item-spinner spin" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons (visible on hover) */}
        <div className="model-pill-actions">
          {showNewButton && (
            <button className="context-bar-btn" onClick={onNewSession} title="New chat (Ctrl+N)">
              <Plus size={14} />
            </button>
          )}
          <button className="context-bar-btn" onClick={handleTerminal} title="Terminal">
            <TerminalSquare size={14} />
          </button>
          <button className="context-bar-btn" onClick={() => setSmallWindow(!smallWindow)} title={smallWindow ? 'Normal view' : 'Compact view'}>
            {smallWindow ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
          <button className="context-bar-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings size={14} />
          </button>
          <button className="context-bar-btn context-bar-btn--danger" onClick={handleClose} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Background task indicator */}
      {hasRunning && (
        <span className="bg-task-indicator" title={`${runningTasks.length} task(s) running`}>
          <Zap size={10} />
          <span>{runningTasks.length}</span>
        </span>
      )}
    </div>
  );
};