import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DiffLine } from '../tool-parser';

export type { DiffLine };

// ── New typed segment types (replacing old ParsedSegment) ──

export interface ToolStartSegment {
  type: 'tool_start';
  toolId: string;
  name: string;
  args: Record<string, any>;
  display: string;
}

export interface ToolCompleteSegment {
  type: 'tool_complete';
  toolId: string;
  name: string;
  args: Record<string, any>;
  result: any;
  durationS?: number;
  duration_s?: number;
  inlineDiff?: string;
  inline_diff?: string;
  diffLines?: DiffLine[];
  error?: string;
  display: string;
}

export interface ClarifySegment {
  type: 'clarify';
  question: string;
  choices?: string[];
  multiSelect?: boolean;
  answer?: string;
}

export interface FileNoticeSegment {
  type: 'file_notice';
  filename: string;
}

export interface ThinkingSegment {
  type: 'thinking';
  content: string;
}

export interface ReasoningSegment {
  type: 'reasoning';
  content: string;
}

export interface DiffSegment {
  type: 'diff';
  content: string;
  diffLines?: DiffLine[];
}

export interface TextSegment {
  type: 'text';
  content: string;
}

export interface StatusSegment {
  type: 'status';
  tokens: number;
  durationS: number;
}

export type StreamSegment =
  | ToolStartSegment
  | ToolCompleteSegment
  | ClarifySegment
  | FileNoticeSegment
  | ThinkingSegment
  | ReasoningSegment
  | DiffSegment
  | TextSegment
  | StatusSegment;

export interface InventoryPayload {
  providers: Array<{
    slug: string;
    name: string;
    models: string[];
    total_models: number;
    is_current: boolean;
    authenticated: boolean;
    auth_type: string;
    key_env: string;
    warning: string;
  }>;
  model: string;
  provider: string;
  error?: string;
}

export interface ElectronAPI {
  // Invoke (returns Promise)
  getConfig: () => Promise<Record<string, any>>;
  getInventory: (options?: { refresh?: boolean }) => Promise<InventoryPayload>;
  applyProviderModel?: (provider: string, model: string) => Promise<{ success?: boolean; provider?: string; model?: string; error?: string } | undefined>;
  launchHermesAuth?: (provider: string) => Promise<{ success?: boolean; error?: string } | undefined>;
  captureScreenshot: () => Promise<{ path: string; name: string } | null>;
  openFileDialog: () => Promise<Array<{ path: string; name: string }> | null>;
  listSessions: () => Promise<any[]>;
  getSession: (sessionId: string) => Promise<any[]>;
  readDroppedFile: (file: string | File) => Promise<{
    name: string;
    path: string;
    content: string | null;
    tooBig: boolean;
    size: number;
    ext?: string;
    isImage?: boolean;
    error?: string;
  }>;
  readDir: (dirPath: string) => Promise<Array<{name: string, isDir: boolean, size: number}>>;
  readClipboard: () => Promise<string>;
  captureContext: () => Promise<{ screenshot?: { path: string; name: string }; clipboardText?: string }>;
  readMemory: () => Promise<{ memory?: string; user?: string; error?: string }>;
  saveMemory: (data: { memory?: string; user?: string }) => Promise<{ success?: boolean; error?: string }>;
  searchSessions: (query: string) => Promise<any[]>;

  // Background tasks
  dispatchBackground: (data: { text: string; sessionId?: string; provider?: string; model?: string }) => Promise<string>;
  listBackgroundTasks: () => Promise<any[]>;
  getBackgroundTask: (taskId: string) => Promise<any>;
  clearBackgroundTask: (taskId: string) => Promise<boolean>;
  onBackgroundTaskUpdate: (cb: (task: any) => void) => () => void;
  onBackgroundTaskClicked: (cb: (taskId: string) => void) => () => void;

  // Quick actions
  quickActionExecute: (data: { action: string; text: string }) => Promise<string>;
  quickActionClose: () => void;
  onQuickActionText: (cb: (text: string) => void) => () => void;

  // One-way sends
  setProviderAndModel: (provider: string, model: string) => void;
  saveSession: (data: { sessionId: string; markdown: string }) => void;
  registerSessionMapping: (overlaySessionId: string, hermesSessionId: string) => void;
  abortStream: () => void;
  closeOverlay: () => void;
  resizeOverlayContent: (height: number) => void;
  setOverlayPosition: (position: 'left' | 'right') => void;
  openTerminal: () => void;
  openPath: (path: string) => void;
  resetBounds: () => void;
  setLaunchAtStartup: (enable: boolean) => void;
  setGlobalHotkey: (hotkey: string) => void;
  setAlwaysOnTop: (enable: boolean) => void;

  setSmallWindow: (enable: boolean) => void;
  clearAllSessions: () => Promise<boolean>;
  sendMessage: (data: {
    text: string;
    file?: string;
    sessionId: string;
    toolMode: string;
    provider?: string;
    model?: string;
  }) => void;
  sendInput: (input: string) => void;

  // Overlay Drag
  overlayDragStart?: () => void;
  overlayDragMove?: (dx: number, dy: number) => void;
  overlayDragEnd?: () => void;

  // Echo Mode
  transcribeAudio: (buffer: Uint8Array) => Promise<string>;
  synthesizeSpeech: (payload: { text: string, voice?: string, provider?: string, requestId?: string, streamId?: string, stream?: boolean }) => Promise<number[] | boolean>;
  onEchoTtsAudio: (cb: (event: { requestId: string; streamId: string; chunk: Uint8Array }) => void) => () => void;
  onEchoTtsComplete: (cb: (event: { requestId: string; streamId: string; error?: string }) => void) => () => void;
  echoSendMessage: (payload: { text: string; imagePath?: string; requestId?: string; sessionId?: string; freshText?: string }) => Promise<string>;
  cancelEchoMessage: (requestId: string) => void;
  echoSettingsChanged: (settings: Record<string, any>) => void;
  triggerEchoMode: () => void;
  triggerWakeWord: () => void;

  // Listeners (returns cleanup function)
  onVisibilityChange: (cb: (visible: boolean) => void) => () => void;
  onFocusInput: (cb: () => void) => () => void;
  onStreamSegment: (cb: (segment: StreamSegment) => void) => () => void;
  onStreamEnd: (cb: (result: { code: number | null }) => void) => () => void;
  onStreamError: (cb: (error: string) => void) => () => void;
  onEnterEchoMode: (cb: () => void) => () => void;
  onEchoStreamChunk: (cb: (event: { requestId: string; chunk: string }) => void) => () => void;
  onEchoStreamEvent: (cb: (event: { requestId: string; event: StreamSegment }) => void) => () => void;
  onPushToTalkStart: (cb: () => void) => () => void;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Invoke ──
  getConfig: () => ipcRenderer.invoke('get-config'),
  getInventory: (options?: { refresh?: boolean }) => ipcRenderer.invoke('get-inventory', options ?? {}),
  applyProviderModel: (provider: string, model: string) => ipcRenderer.invoke('apply-provider-model', { provider, model }),
  launchHermesAuth: (provider: string) => ipcRenderer.invoke('launch-hermes-auth', provider),
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  getSession: (sessionId: string) => ipcRenderer.invoke('get-session', sessionId),
  readDroppedFile: (file: string | File) => {
    const filePath = typeof file === 'string' ? file : webUtils.getPathForFile(file);
    return ipcRenderer.invoke('read-dropped-file', filePath);
  },
  readDir: (dirPath: string) => ipcRenderer.invoke('read-dir', dirPath),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  captureContext: () => ipcRenderer.invoke('capture-context'),
  readMemory: () => ipcRenderer.invoke('read-memory'),
  saveMemory: (data: { memory?: string; user?: string }) => ipcRenderer.invoke('save-memory', data),
  searchSessions: (query: string) => ipcRenderer.invoke('search-sessions', query),

  // Background tasks
  dispatchBackground: (data: { text: string; sessionId?: string; provider?: string; model?: string }) =>
    ipcRenderer.invoke('dispatch-background', data),
  listBackgroundTasks: () => ipcRenderer.invoke('list-background-tasks'),
  getBackgroundTask: (taskId: string) => ipcRenderer.invoke('get-background-task', taskId),
  clearBackgroundTask: (taskId: string) => ipcRenderer.invoke('clear-background-task', taskId),

  // Quick actions
  quickActionExecute: (data: { action: string; text: string }) =>
    ipcRenderer.invoke('quick-action-execute', data),
  quickActionClose: () => ipcRenderer.send('quick-action-close'),

  // ── One-way sends ──
  setProviderAndModel: (provider: string, model: string) =>
    ipcRenderer.send('set-provider-model', provider, model),
  saveSession: (data: { sessionId: string; markdown: string }) =>
    ipcRenderer.send('save-session', data),
  registerSessionMapping: (overlaySessionId: string, hermesSessionId: string) =>
    ipcRenderer.send('register-session-mapping', overlaySessionId, hermesSessionId),
  abortStream: () => ipcRenderer.send('abort-stream'),
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  resizeOverlayContent: (height: number) => ipcRenderer.send('resize-overlay-content', height),
  setOverlayPosition: (position: 'left' | 'right') => ipcRenderer.send('set-overlay-position', position),
  openTerminal: () => ipcRenderer.send('open-terminal'),
  openPath: (path: string) => ipcRenderer.send('open-path', path),
  resetBounds: () => ipcRenderer.send('reset-bounds'),
  setLaunchAtStartup: (enable: boolean) =>
    ipcRenderer.send('set-launch-at-startup', enable),
  setGlobalHotkey: (hotkey: string) =>
    ipcRenderer.send('set-global-hotkey', hotkey),
  setAlwaysOnTop: (enable: boolean) =>
    ipcRenderer.send('set-always-on-top', enable),

  setSmallWindow: (enable: boolean) =>
    ipcRenderer.send('set-small-window', enable),
  clearAllSessions: () => ipcRenderer.invoke('clear-all-sessions'),
  sendMessage: (data: {
    text: string;
    file?: string;
    sessionId: string;
    toolMode: string;
    provider?: string;
    model?: string;
  }) => ipcRenderer.send('send-message', data),
  sendInput: (input: string) => ipcRenderer.send('send-input', input),

  // Overlay Drag
  overlayDragStart: () => ipcRenderer.send('overlay-drag-start'),
  overlayDragMove: (dx: number, dy: number) => ipcRenderer.send('overlay-drag-move', dx, dy),
  overlayDragEnd: () => ipcRenderer.send('overlay-drag-end'),

  // Echo Mode
  transcribeAudio: (buffer: Uint8Array) =>
    ipcRenderer.invoke('transcribe-audio', buffer),
  synthesizeSpeech: (payload: { text: string, voice?: string, provider?: string, requestId?: string, streamId?: string, stream?: boolean }) =>
    ipcRenderer.invoke('synthesize-speech', payload),
  onEchoTtsAudio: (cb: (event: { requestId: string; streamId: string; chunk: Uint8Array }) => void) => {
    const handler = (_e: any, event: { requestId: string; streamId: string; chunk: Uint8Array }) => cb(event);
    ipcRenderer.on('echo-tts-audio', handler);
    return () => ipcRenderer.removeListener('echo-tts-audio', handler);
  },
  onEchoTtsComplete: (cb: (event: { requestId: string; streamId: string; error?: string }) => void) => {
    const handler = (_e: any, event: { requestId: string; streamId: string; error?: string }) => cb(event);
    ipcRenderer.on('echo-tts-complete', handler);
    return () => ipcRenderer.removeListener('echo-tts-complete', handler);
  },
  echoSendMessage: (payload: { text: string; imagePath?: string; requestId?: string; sessionId?: string; freshText?: string }) =>
    ipcRenderer.invoke('echo-send-message', payload),
  cancelEchoMessage: (requestId: string) => ipcRenderer.send('echo-cancel-message', requestId),
  echoSettingsChanged: (settings: Record<string, any>) =>
    ipcRenderer.send('echo-settings-changed', settings),
  triggerEchoMode: () => ipcRenderer.send('trigger-echo-mode'),
  triggerWakeWord: () => ipcRenderer.send('trigger-wake-word'),

  // ── Listeners ──
  onVisibilityChange: (cb: (visible: boolean) => void) => {
    const handler = (_e: any, v: boolean) => cb(v);
    ipcRenderer.on('visibility-change', handler);
    return () => ipcRenderer.removeListener('visibility-change', handler);
  },
  onFocusInput: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('focus-input', handler);
    return () => ipcRenderer.removeListener('focus-input', handler);
  },
  onStreamSegment: (cb: (segment: StreamSegment) => void) => {
    const handler = (_e: any, seg: StreamSegment) => cb(seg);
    ipcRenderer.on('stream-segment', handler);
    return () => ipcRenderer.removeListener('stream-segment', handler);
  },
  onStreamEnd: (cb: (result: { code: number | null }) => void) => {
    const handler = (_e: any, result: { code: number | null }) => cb(result);
    ipcRenderer.on('stream-end', handler);
    return () => ipcRenderer.removeListener('stream-end', handler);
  },
  onStreamError: (cb: (error: string) => void) => {
    const handler = (_e: any, error: string) => cb(error);
    ipcRenderer.on('stream-error', handler);
    return () => ipcRenderer.removeListener('stream-error', handler);
  },
  onEnterEchoMode: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('enter-echo-mode', handler);
    return () => ipcRenderer.removeListener('enter-echo-mode', handler);
  },
  onEchoStreamChunk: (cb: (event: { requestId: string; chunk: string }) => void) => {
    const handler = (_e: any, event: { requestId: string; chunk: string }) => cb(event);
    ipcRenderer.on('echo-stream-chunk', handler);
    return () => ipcRenderer.removeListener('echo-stream-chunk', handler);
  },
  onEchoStreamEvent: (cb: (event: { requestId: string; event: StreamSegment }) => void) => {
    const handler = (_e: any, event: { requestId: string; event: StreamSegment }) => cb(event);
    ipcRenderer.on('echo-stream-event', handler);
    return () => ipcRenderer.removeListener('echo-stream-event', handler);
  },
  onPushToTalkStart: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('push-to-talk-start', handler);
    return () => ipcRenderer.removeListener('push-to-talk-start', handler);
  },
  onBackgroundTaskUpdate: (cb: (task: any) => void) => {
    const handler = (_e: any, task: any) => cb(task);
    ipcRenderer.on('background-task-update', handler);
    return () => ipcRenderer.removeListener('background-task-update', handler);
  },
  onBackgroundTaskClicked: (cb: (taskId: string) => void) => {
    const handler = (_e: any, taskId: string) => cb(taskId);
    ipcRenderer.on('background-task-clicked', handler);
    return () => ipcRenderer.removeListener('background-task-clicked', handler);
  },
  onQuickActionText: (cb: (text: string) => void) => {
    const handler = (_e: any, text: string) => cb(text);
    ipcRenderer.on('quick-action-text', handler);
    return () => ipcRenderer.removeListener('quick-action-text', handler);
  },
} satisfies ElectronAPI);
