/**
 * Store Selectors — Granular, memoized selectors for Zustand.
 * 
 * Using individual selectors instead of destructuring the whole store
 * prevents unnecessary re-renders when unrelated state changes.
 * 
 * Usage:
 *   const messages = useMessages();
 *   const { isStreaming } = useStreamState();
 *   const theme = useTheme();
 */

import { useOverlayStore } from './overlayStore';
import type { Message, StreamState, ToolMode, InventoryProvider, AttachedFile } from './overlayStore';

// ── Session ──
export const useMessages = () => useOverlayStore((s) => s.messages);
export const useSessionId = () => useOverlayStore((s) => s.sessionId);

// ── Streaming ──
export const useStreamState = () => useOverlayStore((s) => s.streamState);
export const useIsStreaming = () => useOverlayStore((s) => s.streamState.isStreaming);

// ── Input ──
export const useToolMode = () => useOverlayStore((s) => s.toolMode);
export const useInputHistory = () => useOverlayStore((s) => s.inputHistory);
export const usePendingAttachments = () => useOverlayStore((s) => s.pendingAttachments);

// ── Model / Provider ──
export const useActiveModel = () => useOverlayStore((s) => s.activeModel);
export const useActiveProvider = () => useOverlayStore((s) => s.activeProvider);
export const useInventory = () => useOverlayStore((s) => s.inventory);
export const useInventoryLoading = () => useOverlayStore((s) => s.inventoryLoading);

// ── UI State ──
export const useIsSettingsOpen = () => useOverlayStore((s) => s.isSettingsOpen);

// ── Settings (grouped) ──
export const useAppearanceSettings = () =>
  useOverlayStore((s) => ({
    theme: s.theme,
    accentColor: s.accentColor,
    fontFamily: s.fontFamily,
    smallWindow: s.smallWindow,
  }));

export const useWindowSettings = () =>
  useOverlayStore((s) => ({
    alwaysOnTop: s.alwaysOnTop,
    launchAtStartup: s.launchAtStartup,
    globalHotkey: s.globalHotkey,
  }));

export const useEchoSettings = () =>
  useOverlayStore((s) => ({
    echoClapWakeEnabled: s.echoClapWakeEnabled,
    echoVoiceModeEnabled: s.echoVoiceModeEnabled,
    echoInterruptWords: s.echoInterruptWords,
    echoExitWords: s.echoExitWords,
    echoClapSensitivity: s.echoClapSensitivity,
    echoTtsProvider: s.echoTtsProvider,
    echoTtsVoice: s.echoTtsVoice,
    echoWakeWordEnabled: s.echoWakeWordEnabled,
    echoWakeWord: s.echoWakeWord,
    echoDoubleClapMinimize: s.echoDoubleClapMinimize,
  }));

// ── Theme (individual, for high-frequency access) ──
export const useTheme = () => useOverlayStore((s) => s.theme);
export const useAccentColor = () => useOverlayStore((s) => s.accentColor);

// ── Actions (stable references, never cause re-renders) ──
export const useSessionActions = () =>
  useOverlayStore((s) => ({
    addMessage: s.addMessage,
    updateLastMessage: s.updateLastMessage,
    appendSegmentToLast: s.appendSegmentToLast,
    clearSession: s.clearSession,
    newSession: s.newSession,
    hydrateSession: s.hydrateSession,
  }));

export const useStreamActions = () =>
  useOverlayStore((s) => ({
    setStreamState: s.setStreamState,
  }));

export const useInputActions = () =>
  useOverlayStore((s) => ({
    cycleToolMode: s.cycleToolMode,
    setToolMode: s.setToolMode,
    addToHistory: s.addToHistory,
    addPendingAttachments: s.addPendingAttachments,
    removePendingAttachment: s.removePendingAttachment,
    clearPendingAttachments: s.clearPendingAttachments,
  }));

export const useSettingsActions = () =>
  useOverlayStore((s) => ({
    setSettingsOpen: s.setSettingsOpen,
    setLaunchAtStartup: s.setLaunchAtStartup,
    setGlobalHotkey: s.setGlobalHotkey,
    setAlwaysOnTop: s.setAlwaysOnTop,
    setSmallWindow: s.setSmallWindow,
    setTheme: s.setTheme,
    setAccentColor: s.setAccentColor,
    setFontFamily: s.setFontFamily,
    setLocalMode: s.setLocalMode,
    setActiveModel: s.setActiveModel,
    setActiveProvider: s.setActiveProvider,
    setToolMode: s.setToolMode,
  }));

export const useEchoActions = () =>
  useOverlayStore((s) => ({
    setEchoClapWakeEnabled: s.setEchoClapWakeEnabled,
    setEchoInterruptWords: s.setEchoInterruptWords,
    setEchoExitWords: s.setEchoExitWords,
    setEchoVoiceModeEnabled: s.setEchoVoiceModeEnabled,
    setEchoClapSensitivity: s.setEchoClapSensitivity,
    setEchoTtsProvider: s.setEchoTtsProvider,
    setEchoTtsVoice: s.setEchoTtsVoice,
    setEchoWakeWordEnabled: s.setEchoWakeWordEnabled,
    setEchoWakeWord: s.setEchoWakeWord,
    setEchoDoubleClapMinimize: s.setEchoDoubleClapMinimize,
  }));

export const useInventoryActions = () =>
  useOverlayStore((s) => ({
    setInventory: s.setInventory,
    setInventoryLoading: s.setInventoryLoading,
  }));
