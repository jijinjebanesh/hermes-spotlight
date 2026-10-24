import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ═══════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════ */

export type ToolMode = 'all' | 'terminal' | 'none';
export type Theme = 'system' | 'light' | 'dark';

export interface ToolCall {
  id: string;
  name: string;
  command: string;
  output?: string;
  status: 'pending' | 'success' | 'error';
}

export interface AttachedFile {
  id: string;
  name: string;
  path: string;
  content: string | null;
  tooBig: boolean;
  size: number;
  ext: string;
  isImage: boolean;
}

export type StreamSegment =
  | { type: 'text'; content?: string }
  | { type: 'tool_start'; toolId?: string; name?: string; args?: Record<string, any>; display?: string }
  | { type: 'tool_complete'; toolId?: string; name?: string; args?: Record<string, any>; result?: any; durationS?: number; inlineDiff?: string; diffLines?: Array<{ type: string; text: string }>; error?: string; display?: string }
  | { type: 'clarify'; question?: string; choices?: string[]; multiSelect?: boolean; answer?: string }
  | { type: 'thinking'; content?: string }
  | { type: 'reasoning'; content?: string }
  | { type: 'diff'; content?: string; diffLines?: Array<{ type: string; text: string }> }
  | { type: 'file_notice'; filename?: string }
  | { type: 'status'; tokens?: number; durationS?: number };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  cancelled?: boolean;
  toolCalls?: ToolCall[];
  segments?: StreamSegment[];
  attachments?: AttachedFile[];
}

export interface StreamState {
  isStreaming: boolean;
  tokens: number;
  duration: number;
  mode: 'thinking' | 'working' | 'running' | 'searching' | 'idle';
}

export interface InventoryProvider {
  slug: string;
  name: string;
  models: string[];
  total_models: number;
  is_current: boolean;
  authenticated: boolean;
  auth_type: string;
  key_env: string;
  warning: string;
}

/* ═══════════════════════════════════════════════
   STORE INTERFACE
   ═══════════════════════════════════════════════ */

interface OverlayState {
  // Session
  sessionId: string;
  messages: Message[];

  // Stream state
  streamState: StreamState;

  // Input & Tools
  toolMode: ToolMode;
  inputHistory: string[];
  pendingAttachments: AttachedFile[];

  // Config
  localMode: boolean;
  activeModel: string;
  activeProvider: string;

  // Live inventory
  inventory: InventoryProvider[];
  inventoryLoading: boolean;

  // UI State
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;
  isGuideOpen: boolean;
  launchAtStartup: boolean;
  globalHotkey: string;
  alwaysOnTop: boolean;
  smallWindow: boolean;
  theme: Theme;
  accentColor: string;
  fontFamily: string;

  // Echo Settings
  echoClapWakeEnabled: boolean;
  echoVoiceModeEnabled: boolean;
  echoInterruptWords: string[];
  echoExitWords: string[];
  echoClapSensitivity: number;
  echoTtsProvider: string;
  echoTtsVoice: string;
  echoWakeWordEnabled: boolean;
  echoWakeWord: string;
  echoDoubleClapMinimize: boolean;

  // Screen awareness
  autoCaptureContext: boolean;
  autoCaptureScreenshot: boolean;

  // Background tasks
  backgroundTasks: any[];

  // Actions
  setSettingsOpen: (open: boolean) => void;
  setHistoryOpen: (open: boolean) => void;
  setGuideOpen: (open: boolean) => void;
  setLaunchAtStartup: (enable: boolean) => void;
  setGlobalHotkey: (key: string) => void;
  setAlwaysOnTop: (always: boolean) => void;
  setSmallWindow: (s: boolean) => void;
  setTheme: (t: Theme) => void;
  setAccentColor: (color: string) => void;
  setFontFamily: (f: string) => void;
  setToolMode: (mode: ToolMode) => void;

  addMessage: (msg: Message) => void;
  updateLastMessage: (updater: (msg: Message) => Message) => void;
  appendSegmentToLast: (segment: StreamSegment) => void;
  clearSession: () => void;
  newSession: () => void;
  hydrateSession: (sessionId: string, messages: Message[]) => void;
  setStreamState: (state: Partial<StreamState>) => void;
  cycleToolMode: () => void;
  setLocalMode: (enabled: boolean) => void;
  setActiveModel: (model: string) => void;
  setActiveProvider: (provider: string) => void;
  setInventory: (providers: InventoryProvider[]) => void;
  setInventoryLoading: (loading: boolean) => void;
  addToHistory: (input: string) => void;
  addPendingAttachments: (files: AttachedFile[]) => void;
  removePendingAttachment: (fileId: string) => void;
  clearPendingAttachments: () => void;

  setEchoClapWakeEnabled: (enabled: boolean) => void;
  setEchoInterruptWords: (words: string[]) => void;
  setEchoExitWords: (words: string[]) => void;
  setEchoVoiceModeEnabled: (enabled: boolean) => void;
  setEchoClapSensitivity: (sensitivity: number) => void;
  setEchoTtsProvider: (provider: string) => void;
  setEchoTtsVoice: (voice: string) => void;
  setEchoWakeWordEnabled: (enabled: boolean) => void;
  setEchoWakeWord: (word: string) => void;
  setEchoDoubleClapMinimize: (enabled: boolean) => void;
  setAutoCaptureContext: (enabled: boolean) => void;
  setAutoCaptureScreenshot: (enabled: boolean) => void;

  setBackgroundTasks: (tasks: any[]) => void;
  addBackgroundTask: (task: any) => void;
  updateBackgroundTask: (task: any) => void;
  clearBackgroundTask: (taskId: string) => void;
}

/* ═══════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════ */

export const generateId = () =>
  crypto.randomUUID?.() || Math.random().toString(36).substring(2, 15);

/* ═══════════════════════════════════════════════
   STORE
   ═══════════════════════════════════════════════ */

export const useOverlayStore = create<OverlayState>()(
  persist(
    (set, get) => ({
      sessionId: generateId(),
      messages: [],

      streamState: {
        isStreaming: false,
        tokens: 0,
        duration: 0,
        mode: 'idle',
      },

      toolMode: 'all' as ToolMode,
      inputHistory: [],
      pendingAttachments: [],

      localMode: false,
      activeModel: '',
      activeProvider: '',

      inventory: [],
      inventoryLoading: false,

      // UI State
      isSettingsOpen: false,
      isHistoryOpen: false,
      isGuideOpen: false,
      launchAtStartup: false,
      globalHotkey: 'Control+Space',
      alwaysOnTop: true,
      smallWindow: false,
      theme: 'light' as Theme,
      accentColor: 'blue',
      fontFamily: 'system-ui',

      // Echo Settings
      echoClapWakeEnabled: true,
      echoVoiceModeEnabled: false,
      echoInterruptWords: ['stop', 'wait', 'shut up', 'hey hermes'],
      echoExitWords: ['goodbye', 'close', 'exit', 'stop reading'],
      echoClapSensitivity: 0.5,
      echoTtsProvider: 'hermes',
      echoTtsVoice: '',
      echoWakeWordEnabled: false,
      echoWakeWord: 'hey hermes',
      echoDoubleClapMinimize: false,

      autoCaptureContext: true,
      autoCaptureScreenshot: false,
      backgroundTasks: [],

      /* ── Actions ── */

      setSettingsOpen: (open) => set({ isSettingsOpen: open }),
      setHistoryOpen: (open) => set({ isHistoryOpen: open }),
      setGuideOpen: (open) => set({ isGuideOpen: open }),
      setLaunchAtStartup: (enable) => {
        set({ launchAtStartup: enable });
        window.electronAPI?.setLaunchAtStartup(enable);
      },
      setGlobalHotkey: (hotkey) => {
        set({ globalHotkey: hotkey });
        window.electronAPI?.setGlobalHotkey(hotkey);
      },
      setAlwaysOnTop: (enable) => {
        set({ alwaysOnTop: enable });
        window.electronAPI?.setAlwaysOnTop(enable);
      },
      setSmallWindow: (enable) => {
        set({ smallWindow: enable });
        window.electronAPI?.setSmallWindow(enable);
      },
      setTheme: (theme) => set({ theme }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setToolMode: (mode) => set({ toolMode: mode }),

      addMessage: (msg) =>
        set((state) => ({ messages: [...state.messages, msg] })),

      updateLastMessage: (updater) =>
        set((state) => {
          const msgs = [...state.messages];
          if (msgs.length > 0) {
            msgs[msgs.length - 1] = updater(msgs[msgs.length - 1]);
          }
          return { messages: msgs };
        }),

      appendSegmentToLast: (segment) =>
        set((state) => {
          const msgs = [...state.messages];
          if (msgs.length === 0) return state;
          const last = { ...msgs[msgs.length - 1] };
          if (last.role !== 'assistant') return state;

          let segments = [...(last.segments || [])];

          if (segment.type === 'tool_complete' && segment.toolId) {
            const startIdx = segments.findIndex(
              (s) => s.type === 'tool_start' && s.toolId === segment.toolId
            );
            if (startIdx !== -1) {
              segments[startIdx] = segment;
            } else {
              segments.push(segment);
            }
          } else if (segment.type === 'text') {
            // Merge consecutive text segments
            const lastSeg = segments[segments.length - 1];
            if (lastSeg && lastSeg.type === 'text') {
              segments[segments.length - 1] = {
                ...lastSeg,
                content: (lastSeg.content || '') + segment.content,
              };
            } else {
              segments.push(segment);
            }
          } else {
            segments.push(segment);
          }

          if (segment.type === 'text') {
            // Hermes JSONL text deltas preserve their original whitespace and
            // must concatenate byte-for-byte; inserting a newline corrupts code
            // blocks and inline markdown when a delta splits in the middle.
            last.content = (last.content || '') + (segment.content || '');
          }

          last.segments = segments;
          msgs[msgs.length - 1] = last;
          return { messages: msgs };
        }),

      clearSession: () =>
        set({ messages: [], sessionId: generateId() }),

      newSession: () =>
        set({ messages: [], sessionId: generateId() }),

      hydrateSession: (sessionId, messages) => {
        // Generate a new overlay session ID and register the mapping
        // so that --resume is passed to Hermes CLI
        const newOverlayId = generateId();
        window.electronAPI?.registerSessionMapping(newOverlayId, sessionId);
        set({ sessionId: newOverlayId, messages });
      },

      setStreamState: (newState) =>
        set((state) => ({
          streamState: { ...state.streamState, ...newState },
        })),

      cycleToolMode: () =>
        set((state) => {
          const modes: ToolMode[] = ['all', 'terminal', 'none'];
          const nextIndex = (modes.indexOf(state.toolMode) + 1) % modes.length;
          return { toolMode: modes[nextIndex] };
        }),

      setLocalMode: (enabled) => set({ localMode: enabled }),
      setActiveModel: (model) => set({ activeModel: model }),
      setActiveProvider: (provider) => set({ activeProvider: provider }),
      setInventory: (providers) => set({ inventory: providers }),
      setInventoryLoading: (loading) => set({ inventoryLoading: loading }),

      addToHistory: (input) =>
        set((state) => {
          if (!input.trim() || state.inputHistory[0] === input) return state;
          return {
            inputHistory: [input, ...state.inputHistory].slice(0, 50),
          };
        }),

      addPendingAttachments: (files) =>
        set((state) => ({
          pendingAttachments: [...state.pendingAttachments, ...files],
        })),

      removePendingAttachment: (fileId) =>
        set((state) => ({
          pendingAttachments: state.pendingAttachments.filter(f => f.id !== fileId),
        })),

      clearPendingAttachments: () => set({ pendingAttachments: [] }),

      setEchoClapWakeEnabled: (enabled) => {
        set({ echoClapWakeEnabled: enabled });
        window.electronAPI?.echoSettingsChanged?.({ echoClapWakeEnabled: enabled });
      },
      setEchoInterruptWords: (words) => set({ echoInterruptWords: words }),
      setEchoExitWords: (words) => set({ echoExitWords: words }),
      setEchoVoiceModeEnabled: (enabled) => {
        set({ echoVoiceModeEnabled: enabled });
        window.electronAPI?.echoSettingsChanged?.({ echoVoiceModeEnabled: enabled });
      },
      setEchoClapSensitivity: (sensitivity) => {
        set({ echoClapSensitivity: sensitivity });
        window.electronAPI?.echoSettingsChanged?.({ echoClapSensitivity: sensitivity });
      },
      setEchoTtsProvider: (provider) => set({ echoTtsProvider: provider }),
      setEchoTtsVoice: (voice) => set({ echoTtsVoice: voice }),
      setEchoWakeWordEnabled: (enabled) => {
        set({ echoWakeWordEnabled: enabled });
        window.electronAPI?.echoSettingsChanged?.({ echoWakeWordEnabled: enabled });
      },
      setEchoWakeWord: (word) => {
        set({ echoWakeWord: word });
        window.electronAPI?.echoSettingsChanged?.({ echoWakeWord: word });
      },
      setEchoDoubleClapMinimize: (enabled) => {
        set({ echoDoubleClapMinimize: enabled });
        window.electronAPI?.echoSettingsChanged?.({ echoDoubleClapMinimize: enabled });
      },
      setAutoCaptureContext: (enabled) => set({ autoCaptureContext: enabled }),
      setAutoCaptureScreenshot: (enabled) => set({ autoCaptureScreenshot: enabled }),

      setBackgroundTasks: (tasks) => set({ backgroundTasks: tasks }),
      addBackgroundTask: (task) => set((state) => ({
        backgroundTasks: [task, ...state.backgroundTasks].slice(0, 50),
      })),
      updateBackgroundTask: (task) => set((state) => ({
        backgroundTasks: state.backgroundTasks.map((t) =>
          t.id === task.id ? task : t
        ),
      })),
      clearBackgroundTask: (taskId) => set((state) => ({
        backgroundTasks: state.backgroundTasks.filter((t) => t.id !== taskId),
      })),
    }),
    {
      name: 'hermes-spotlight-storage-v1',
      version: 5,
      migrate: (persisted: any, version: number) => {
        // Older Echo defaults forced Edge Aria even when Hermes itself is
        // configured for a more natural TTS provider. Keep explicit choices.
        if (version < 2 && persisted?.echoTtsProvider === 'edge-tts'
          && persisted?.echoTtsVoice === 'en-US-AriaNeural') {
          persisted.echoTtsProvider = 'hermes';
          persisted.echoTtsVoice = '';
        }
        if (version < 3 && persisted?.echoTtsProvider === 'hermes') {
          persisted.echoTtsProvider = 'system';
        }
        if (version < 4 && persisted?.echoTtsProvider === 'system') {
          persisted.echoTtsProvider = 'hermes';
          persisted.echoTtsVoice = '';
        }
        if (version < 5 && persisted?.echoTtsProvider === 'edge-tts'
          && persisted?.echoTtsVoice === 'en-US-AriaNeural') {
          persisted.echoTtsProvider = 'hermes';
          persisted.echoTtsVoice = '';
        }
        return persisted;
      },
      partialize: (state) => ({
        localMode: state.localMode,
        activeModel: state.activeModel,
        activeProvider: state.activeProvider,
        sessionId: state.sessionId,
        inputHistory: state.inputHistory,
        launchAtStartup: state.launchAtStartup,
        globalHotkey: state.globalHotkey,
        alwaysOnTop: state.alwaysOnTop,
        smallWindow: state.smallWindow,
        toolMode: state.toolMode,
        theme: state.theme,
        accentColor: state.accentColor,
        fontFamily: state.fontFamily,
        echoClapWakeEnabled: state.echoClapWakeEnabled,
        echoWakeWordEnabled: state.echoWakeWordEnabled,
        echoWakeWord: state.echoWakeWord,
        echoClapSensitivity: state.echoClapSensitivity,
        echoVoiceModeEnabled: state.echoVoiceModeEnabled,
        echoInterruptWords: state.echoInterruptWords,
        echoExitWords: state.echoExitWords,
        echoTtsProvider: state.echoTtsProvider,
        echoTtsVoice: state.echoTtsVoice,
        echoDoubleClapMinimize: state.echoDoubleClapMinimize,
        autoCaptureContext: state.autoCaptureContext,
        autoCaptureScreenshot: state.autoCaptureScreenshot,
      }),
    }
  )
);
