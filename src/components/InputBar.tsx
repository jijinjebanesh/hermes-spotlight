import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { Square, ArrowUp, Mic, Zap, CornerDownLeft } from 'lucide-react';
import { useOverlayStore, generateId } from '../store/overlayStore';
import { getElectronAPI } from '../hooks/useElectronAPI';
import { AttachmentBar } from './input/AttachmentBar';
import { AutocompleteMenu } from './input/AutocompleteMenu';
import { AttachMenu } from './input/AttachMenu';

const api = getElectronAPI();
const SLASH_COMMANDS = [
  { name: '/model', description: 'Choose a provider, then a model' },
  { name: '/new', description: 'Start a fresh Hermes session' },
  { name: '/clear', description: 'Clear this conversation' },
  { name: '/status', description: 'Show the active session and model' },
  { name: '/usage', description: 'Show response usage and timing' },
  { name: '/history', description: 'Browse recent prompts' },
  { name: '/sessions', description: 'Search and reopen recent sessions' },
  { name: '/save', description: 'Export this conversation' },
  { name: '/branch', description: 'Continue in a separate session' },
  { name: '/help', description: 'See the commands available here' },
  { name: '/settings', description: 'Open Hermes preferences' },
  { name: '/position', description: 'Move the overlay left or right' },
  { name: '/agents', description: 'Show background tasks' },
] as const;

interface InputBarProps {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onOpenModelPicker?: () => void;
  onOpenNavigator?: () => void;
  onOpenSettings?: () => void;
  onPopoverHeightChange?: (height: number) => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  inputRef, onOpenModelPicker, onOpenNavigator, onOpenSettings, onPopoverHeightChange,
}) => {
  const {
    toolMode, streamState,
    messages, addMessage, addToHistory, inputHistory,
    clearSession, newSession, localMode,
    sessionId, setStreamState, updateLastMessage,
    pendingAttachments, addPendingAttachments, removePendingAttachment, clearPendingAttachments
  } = useOverlayStore();

  const [input, setInput] = useState('');
  const [isEditingQuery, setIsEditingQuery] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [rejectTooltip, setRejectTooltip] = useState<string | null>(null);
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const fileAttached = pendingAttachments.length > 0;
  const [echoTooltip, setEchoTooltip] = useState<string | null>(null);
  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user');
  const lastSubmittedQuery = lastUserMessage?.content || '';
  const queryValue = isEditingQuery ? input : (input || lastSubmittedQuery);

  const activateQueryEditor = () => {
    if (!isEditingQuery && lastSubmittedQuery) {
      setInput(lastSubmittedQuery);
      setIsEditingQuery(true);
      requestAnimationFrame(() => inputRef.current?.select());
      return;
    }
    setIsEditingQuery(true);
  };

  // ── AUTOCOMPLETE STATE ──
  const [suggestions, setSuggestions] = useState<Array<{name: string; isDir: boolean; size: number; isCommand?: boolean; description?: string}>>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [autocompletePrefix, setAutocompletePrefix] = useState('');
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [lastWord, setLastWord] = useState('');
  const [autocompleteType, setAutocompleteType] = useState<'file' | 'command'>('file');

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  // Listen for external "edit message" requests from Conversation
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      setInput(detail);
      setIsEditingQuery(true);
      setHistoryIndex(-1);
      setTimeout(() => {
        inputRef.current?.focus();
        if (inputRef.current) {
          inputRef.current.style.height = 'auto';
          const sh = inputRef.current.scrollHeight;
          inputRef.current.style.height = Math.min(sh, 200) + 'px';
        }
      }, 50);
    };
    window.addEventListener('hermes-edit-message', handler);
    return () => window.removeEventListener('hermes-edit-message', handler);
  }, [inputRef]);

  // Global Escape handler
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAttachMenu) {
          setShowAttachMenu(false);
          return;
        }
        if (isAutocompleteOpen) {
          setIsAutocompleteOpen(false);
          return;
        }
        if (input.trim().length > 0) {
          setInput('');
          setIsEditingQuery(true);
          setIsAutocompleteOpen(false);
          resetTextarea();
        } else {
          api?.closeOverlay();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [input, isAutocompleteOpen, showAttachMenu]);

  useEffect(() => {
    const height = isAutocompleteOpen
      ? (autocompleteType === 'command' ? 160 : 220)
      : showAttachMenu ? 252 : 0;
    onPopoverHeightChange?.(height);
  }, [isAutocompleteOpen, autocompleteType, showAttachMenu, onPopoverHeightChange]);

  const resetTextarea = useCallback(() => {
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, [inputRef]);

  // ── AUTOCOMPLETE LOGIC ──
  const fetchFileSuggestions = async (dirPath: string, query: string, word: string) => {
    setAutocompletePrefix(dirPath);
    setAutocompleteQuery(query);
    setLastWord(word);
    setAutocompleteType('file');

    try {
      if (api?.readDir) {
        const results = await api.readDir(dirPath);
        const filtered = results.filter((r: any) => r.name.toLowerCase().startsWith(query.toLowerCase()));
        setSuggestions(filtered);
        setSelectedSuggestionIndex(filtered.length > 0 ? 0 : -1);
        setIsAutocompleteOpen(filtered.length > 0);
      }
    } catch (e) {
      setIsAutocompleteOpen(false);
    }
  };

  const fetchCommandSuggestions = useCallback((query: string) => {
    const prefix = query.startsWith('/') ? query : '/' + query;
    const filtered = SLASH_COMMANDS.filter(cmd => cmd.name.startsWith(prefix));
    if (filtered.length > 0) {
      setSuggestions(filtered.map(cmd => ({ name: cmd.name, description: cmd.description, isDir: false, size: 0, isCommand: true })));
      setAutocompleteType('command');
      setSelectedSuggestionIndex(0);
      setIsAutocompleteOpen(true);
      setAutocompletePrefix('');
      setAutocompleteQuery(query);
      setLastWord(query);
    } else {
      setIsAutocompleteOpen(false);
    }
  }, []);

  const handleSelectSuggestion = (index: number) => {
    const selected = suggestions[index];
    if (!selected) return;

    if (autocompleteType === 'command') {
      setIsAutocompleteOpen(false);
      if (selected.name === '/model') {
        setInput('');
        setIsEditingQuery(false);
        onOpenModelPicker?.();
        return;
      }
      if (selected.name === '/sessions') {
        setInput('');
        setIsEditingQuery(false);
        onOpenNavigator?.();
        return;
      }
      if (selected.name === '/settings') {
        setInput('');
        setIsEditingQuery(false);
        onOpenSettings?.();
        return;
      }
      setIsEditingQuery(true);
      setInput(selected.name + ' ');
    } else {
      const newPath = autocompletePrefix + selected.name + (selected.isDir ? '/' : '');
      const newInput = input.slice(0, -lastWord.length) + newPath;
      setIsEditingQuery(true);
      setInput(newInput);
      setIsAutocompleteOpen(false);
      if (selected.isDir) fetchFileSuggestions(newPath, '', newPath);
    }
    inputRef.current?.focus();
  };

  // ── INPUT HANDLER ──
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setShowAttachMenu(false);
    setIsEditingQuery(true);
    setInput(val);
    setHistoryIndex(-1);

    // Check for slash command autocomplete
    if (val.startsWith('/')) {
      const commandPrefix = val.split(/\s/, 1)[0];
      if (val === commandPrefix) fetchCommandSuggestions(val);
      else setIsAutocompleteOpen(false);
      return;
    }

    // Check for path autocomplete
    const words = val.split(/\s+/);
    const word = words[words.length - 1];
    const isPath = /^(?:[a-zA-Z]:[/\\]|[/]|\.[/\\]|\.\.[/\\]|~[/\\])/.test(word);
    if (isPath) {
      const lastSlashIndex = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'));
      if (lastSlashIndex !== -1) {
        const dirPath = word.substring(0, lastSlashIndex + 1);
        const query = word.substring(lastSlashIndex + 1);
        fetchFileSuggestions(dirPath, query, word);
      } else {
        setIsAutocompleteOpen(false);
      }
    } else {
      setIsAutocompleteOpen(false);
    }

    // Auto-resize
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const sh = inputRef.current.scrollHeight;
      inputRef.current.style.height = Math.min(sh, 200) + 'px';
    }
  };

  // ── KEYBOARD HANDLER ──
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // After a result arrives, the last request stays in the search pill. The
    // first typed character starts a fresh request in that same field.
    if (!isEditingQuery && lastSubmittedQuery) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsEditingQuery(true);
        setInput(e.key);
        setHistoryIndex(-1);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        setIsEditingQuery(true);
        setInput('');
        setHistoryIndex(-1);
        return;
      }
      setIsEditingQuery(true);
      setInput(lastSubmittedQuery);
    }

    // Autocomplete navigation
    if (isAutocompleteOpen && suggestions.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        handleSelectSuggestion(selectedSuggestionIndex);
        return;
      }
    }

    // Tab for slash command completion
    if (e.key === 'Tab') {
      e.preventDefault();
      if (input.startsWith('/')) {
        const match = SLASH_COMMANDS.find((c) => c.name.startsWith(input.trim()));
        if (match) setInput(match.name + ' ');
      }
      return;
    }

    // History navigation (only when not in autocomplete)
    if (e.key === 'ArrowUp' && !isAutocompleteOpen) {
      if (input === '' || historyIndex !== -1) {
        e.preventDefault();
        if (inputHistory.length > 0) {
          const nextIdx = Math.min(historyIndex + 1, inputHistory.length - 1);
          setHistoryIndex(nextIdx);
          setInput(inputHistory[nextIdx]);
        }
        return;
      }
    }

    if (e.key === 'ArrowDown' && !isAutocompleteOpen) {
      if (historyIndex !== -1) {
        e.preventDefault();
        if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          setInput(inputHistory[nextIdx]);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setInput('');
        }
        return;
      }
    }

    // Enter key behavior:
    // - Enter alone: send
    // - Shift+Enter: newline (multiline)
    // - Ctrl+Enter: newline (multiline) - NOT background send
    // - Ctrl+Shift+Enter: background send
    if (e.key === 'Enter') {
      if (e.ctrlKey && e.shiftKey) {
        // Ctrl+Shift+Enter → background send
        e.preventDefault();
        handleBackgroundSend();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Enter or Cmd+Enter → insert newline
        e.preventDefault();
        insertNewline();
        return;
      }
      if (e.shiftKey) {
        // Shift+Enter → insert newline (allow default behavior)
        return; // let the default newline insertion happen
      }
      // Enter alone → send
      e.preventDefault();
      handleSubmit();
    }
  };

  const insertNewline = () => {
    if (!inputRef.current) return;
    const el = inputRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newValue = input.substring(0, start) + '\n' + input.substring(end);
    setInput(newValue);
    // Restore cursor position after newline
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = start + 1;
      // Trigger auto-resize
      el.style.height = 'auto';
      const sh = el.scrollHeight;
      el.style.height = Math.min(sh, 200) + 'px';
    }, 0);
  };

  // ── PASTE HANDLER ──
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData?.getData('text');
    if (!isEditingQuery && lastSubmittedQuery && pastedText && pastedText.length <= 2000) {
      e.preventDefault();
      setIsEditingQuery(true);
      setInput(pastedText);
      return;
    }
    if (pastedText && pastedText.length > 2000) {
      e.preventDefault();
      addPendingAttachments([{
        name: `paste_${Date.now()}.txt`,
        path: `clipboard://${generateId()}`,
        content: pastedText,
        tooBig: pastedText.length > 100_000,
        size: pastedText.length,
        ext: 'txt',
        isImage: false,
        id: generateId(),
      }]);
      return;
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            addPendingAttachments([{
              name: file.name || 'Pasted Image.png',
              path: `clipboard://${generateId()}`,
              content: base64,
              tooBig: false,
              size: file.size,
              ext: file.type.split('/')[1] || 'png',
              isImage: true,
              id: generateId(),
            }]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  // ── SUBMIT HANDLER ──
  const handleSubmit = () => {
    if (!input.trim() && !fileAttached) return;

    if (streamState.isStreaming) {
      const trimmed = input.trim();
      if (!trimmed) return;
      addToHistory(trimmed);
      addMessage({
        id: generateId(),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      });
      api?.sendInput(trimmed + '\n');
      setInput('');
      setIsEditingQuery(false);
      setHistoryIndex(-1);
      resetTextarea();
      return;
    }

    const trimmed = input.trim();
    const positionCommand = trimmed.match(/^\/position\s+(left|right)$/i);
    if (positionCommand) {
      api?.setOverlayPosition?.(positionCommand[1].toLowerCase() as 'left' | 'right');
      setInput('');
      setIsEditingQuery(false);
      setIsAutocompleteOpen(false);
      resetTextarea();
      return;
    }
    if (/^\/position(?:\s|$)/i.test(trimmed)) {
      addMessage({
        id: generateId(), role: 'assistant', timestamp: Date.now(),
        content: 'Choose a side with `/position left` or `/position right`.',
      });
      setInput('');
      setIsEditingQuery(false);
      setIsAutocompleteOpen(false);
      resetTextarea();
      return;
    }
    if (trimmed === '/model' || trimmed === '/model --refresh') {
      setInput('');
      setIsEditingQuery(false);
      setIsAutocompleteOpen(false);
      resetTextarea();
      onOpenModelPicker?.();
      return;
    }
    addToHistory(trimmed);

    const isExplicitOpen = trimmed.toLowerCase().startsWith('open ');
    const isOverlayCommand = /^\/(?:model|new|clear|status|usage|history|sessions|save|branch|help|settings|agents|undo|position)(?:\s|$)/i.test(trimmed);
    const isRawAbsolutePath = !isOverlayCommand && /^(?:[a-zA-Z]:[/\\]|[/])/.test(trimmed);

    let targetPath = '';
    let shouldOpenLocally = false;

    if (isExplicitOpen) {
      const pathAfterOpen = trimmed.substring(5).trim();
      const pathLooksLikeFile = /^(?:[a-zA-Z]:[/\\]|[/]|\.[/\\]|\.\.[/\\]|~[/\\])/.test(pathAfterOpen) || pathAfterOpen.includes('.mkv') || pathAfterOpen.includes('.mp4');
      if (pathLooksLikeFile) {
        targetPath = pathAfterOpen;
        shouldOpenLocally = true;
      }
    } else if (isRawAbsolutePath) {
      if (!trimmed.toLowerCase().includes('what') && !trimmed.toLowerCase().includes('why') && !trimmed.toLowerCase().includes('how') && !trimmed.endsWith('?')) {
        targetPath = trimmed;
        shouldOpenLocally = true;
      }
    }

    if (shouldOpenLocally) {
      if (targetPath.startsWith('"') && targetPath.endsWith('"')) targetPath = targetPath.slice(1, -1);
      if (targetPath.startsWith("'") && targetPath.endsWith("'")) targetPath = targetPath.slice(1, -1);

      addMessage({
        id: generateId(),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      });
      addMessage({
        id: generateId(),
        role: 'assistant',
        content: `Opening ${targetPath}...`,
        timestamp: Date.now(),
      });

      api?.openPath?.(targetPath);
      setInput('');
      setIsEditingQuery(false);
      clearPendingAttachments();
      resetTextarea();
      return;
    }

    if (trimmed === '/clear') {
      clearSession();
      clearPendingAttachments();
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/new') {
      newSession();
      clearPendingAttachments();
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed.startsWith('/undo')) {
      const parts = trimmed.split(' ');
      const turns = parts.length > 1 ? parseInt(parts[1], 10) : 1;
      const turnsToUndo = isNaN(turns) ? 1 : turns;
      addMessage({
        id: generateId(),
        role: 'assistant',
        content: `Undo requested (${turnsToUndo} turn${turnsToUndo > 1 ? 's' : ''}) — use the UI to undo messages.`,
        timestamp: Date.now(),
      });
      clearPendingAttachments();
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/save') {
      const messages = useOverlayStore.getState().messages;
      const markdown = [
        `# Session ${sessionId}`,
        `Saved at ${new Date().toISOString()}`,
        '',
        ...messages.map((m) =>
          `**${m.role === 'user' ? 'You' : 'Hermes'}:** ${m.content}`
        ),
      ].join('\n\n');
      api?.saveSession({ sessionId, markdown });
      clearPendingAttachments();
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/history') {
      const history = useOverlayStore.getState().inputHistory;
      addMessage({
        id: generateId(),
        role: 'assistant',
        content: history.length > 0
          ? 'Recent commands:\n' + history.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n')
          : 'No command history yet.',
        timestamp: Date.now(),
      });
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/status') {
      const state = useOverlayStore.getState();
      addMessage({
        id: generateId(), role: 'assistant', timestamp: Date.now(),
        content: [
          '### Session status',
          `- **Provider:** ${state.activeProvider || 'Not selected'}`,
          `- **Model:** ${state.activeModel || 'Hermes default'}`,
          `- **Messages:** ${state.messages.length}`,
          `- **Turn:** ${state.streamState.isStreaming ? 'In progress' : 'Ready'}`,
        ].join('\n'),
      });
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/usage') {
      const state = useOverlayStore.getState();
      const usage = state.streamState.tokens > 0
        ? `${state.streamState.tokens.toLocaleString()} tokens reported`
        : 'Usage will appear after Hermes reports a response';
      addMessage({
        id: generateId(), role: 'assistant', timestamp: Date.now(),
        content: [
          '### Latest response',
          `- **Model:** ${state.activeModel || 'Hermes default'}`,
          `- **Usage:** ${usage}`,
          `- **Elapsed:** ${state.streamState.duration || 0}s`,
        ].join('\n'),
      });
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/help') {
      addMessage({
        id: generateId(), role: 'assistant', timestamp: Date.now(),
        content: [
          '### Hermes quick commands',
          '- `/model` — choose provider and model',
          '- `/new` or `/clear` — start a fresh session',
          '- `/status` and `/usage` — inspect this session',
          '- `/history` and `/save` — review or export',
          '- `/branch` — continue in a separate session',
          '- `/sessions` — reopen a recent session',
          '- `/settings` — open preferences',
        ].join('\n'),
      });
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/agents') {
      const tasks = useOverlayStore.getState().backgroundTasks;
      addMessage({
        id: generateId(), role: 'assistant', timestamp: Date.now(),
        content: tasks.length
          ? '### Background tasks\n' + tasks.map((task, index) => `- ${task.name || task.title || task.id || `Task ${index + 1}`}${task.status ? ` · ${task.status}` : ''}`).join('\n')
          : 'No background tasks are running.',
      });
      setInput('');
      resetTextarea();
      return;
    }

    if (trimmed === '/branch') {
      const currentMessages = [...useOverlayStore.getState().messages];
      newSession();
      currentMessages.forEach((m) => addMessage({ ...m, id: generateId() }));
      setInput('');
      resetTextarea();
      return;
    }

    if (localMode) {
      addMessage({
        id: generateId(),
        role: 'user',
        content: trimmed,
        attachments: pendingAttachments.length > 0 ? [...pendingAttachments] : undefined,
        timestamp: Date.now(),
      });
      setInput('');
      setIsEditingQuery(false);
      clearPendingAttachments();
      resetTextarea();
      return;
    }

    let attachmentContext = '';
    let attachmentPayload: typeof pendingAttachments = [];
    let passthroughFilePath: string | undefined;

    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'rtf'];

    if (pendingAttachments.length > 0) {
      const firstPassthrough = pendingAttachments.find(
        f => f.isImage || docExts.includes(f.ext)
      );
      if (firstPassthrough) passthroughFilePath = firstPassthrough.path;

      const filesWithContent = pendingAttachments.filter(
        f => f.content !== null && !f.tooBig && !f.isImage && !docExts.includes(f.ext)
      );
      if (filesWithContent.length > 0) {
        attachmentContext = filesWithContent
          .map(f => `<file name="${f.name}" path="${f.path}">\n${f.content}\n</file>`)
          .join('\n\n') + '\n\n';
      }
      const binaryFiles = pendingAttachments.filter(
        f => f.isImage || docExts.includes(f.ext)
      );
      if (binaryFiles.length > 0) {
        const tags = binaryFiles
          .map(f => `<file name="${f.name}" path="${f.path}" type="${f.isImage ? 'image' : 'document'}">[Attached — path: ${f.path}]\n</file>`)
          .join('\n\n') + '\n\n';
        attachmentContext += tags;
      }
      const pathOnlyFiles = pendingAttachments.filter(f => f.tooBig && !f.isImage && !docExts.includes(f.ext));
      if (pathOnlyFiles.length > 0) {
        attachmentContext += pathOnlyFiles
          .map(f => `<file name="${f.name}" path="${f.path}">[Large attachment; available at this path]</file>`)
          .join('\n\n') + '\n\n';
      }
      attachmentPayload = [...pendingAttachments];
    }

    const fullPayload = attachmentContext + trimmed;

    addMessage({
      id: generateId(),
      role: 'user',
      content: trimmed,
      attachments: attachmentPayload,
      timestamp: Date.now(),
    });

    addMessage({
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    });

    setStreamState({
      isStreaming: true,
      tokens: 0,
      duration: 0,
      mode: 'thinking',
    });

    const state = useOverlayStore.getState();
    api?.sendMessage({
      text: fullPayload,
      file: passthroughFilePath,
      sessionId,
      toolMode,
      provider: state.activeProvider,
      model: state.activeModel,
    });

    setInput('');
    setIsEditingQuery(false);
    clearPendingAttachments();
    setHistoryIndex(-1);
    resetTextarea();
  };

  // ── STOP HANDLER ──
  const handleStop = () => {
    api?.abortStream();
    setStreamState({ isStreaming: false });
    updateLastMessage((msg) => ({
      ...msg,
      isStreaming: false,
      cancelled: true,
    }));
  };

  // ── BACKGROUND SEND HANDLER ──
  const handleBackgroundSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    addMessage({
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    });

    addMessage({
      id: generateId(),
      role: 'assistant',
      content: '⏳ Running in background... You\'ll get a notification when it\'s done.',
      timestamp: Date.now(),
    });

    const state = useOverlayStore.getState();
    api?.dispatchBackground?.({
      text: trimmed,
      sessionId: undefined,
      provider: state.activeProvider,
      model: state.activeModel,
    });

    setInput('');
    setIsEditingQuery(false);
    clearPendingAttachments();
    resetTextarea();
  };

  // ── TOOLTIP HANDLER ──
  const showReject = (msg: string) => {
    setRejectTooltip(msg);
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setRejectTooltip(null), 2000);
  };

  // ── ATTACH HANDLERS ──
  const handleAttachFile = async () => {
    setShowAttachMenu(false);
    try {
      const result = await api?.openFileDialog();
      if (result?.length) {
        const files = await Promise.all(result.map(item => api?.readDroppedFile(item.path)));
        const attachments = files.filter(Boolean).map(fileResult => ({
          ...fileResult!,
          ext: fileResult!.ext || '',
          isImage: fileResult!.isImage || false,
          id: generateId(),
        }));
        if (attachments.length) addPendingAttachments(attachments);
      }
    } catch (e) {
      showReject('Failed to open file picker');
    }
  };

  const handleScreenshot = async () => {
    setShowAttachMenu(false);
    try {
      const result = await api?.captureScreenshot();
      if (result) {
        const fileResult = await api?.readDroppedFile(result.path);
        if (fileResult) {
          addPendingAttachments([{
            ...fileResult,
            ext: fileResult.ext || '',
            isImage: fileResult.isImage || false,
            id: generateId()
          }]);
        }
      } else {
        showReject('Failed to capture screen');
      }
    } catch (e) {
      showReject('Screenshot error');
    }
  };

  const handleClipboardPaste = async () => {
    setShowAttachMenu(false);
    try {
      const text = await api?.readClipboard?.();
      if (!text || !text.trim()) {
        showReject('Clipboard is empty');
        return;
      }
      const hash = text.substring(0, 40).replace(/[^a-zA-Z0-9]/g, '_') + '_clipboard';
      addPendingAttachments([{
        name: 'Clipboard.txt',
        path: `clipboard://${hash}`,
        content: text,
        tooBig: text.length > 100_000,
        size: text.length,
        ext: 'txt',
        isImage: false,
        id: generateId(),
      }]);
    } catch (e) {
      showReject('Failed to read clipboard');
    }
  };

  const handleEchoMode = () => {
    setEchoTooltip('Starting Echo Mode...');
    setTimeout(() => setEchoTooltip(null), 2000);
    try {
      api?.triggerEchoMode?.();
    } catch (e) {
      console.error('Failed to trigger Echo Mode:', e);
      setEchoTooltip('Echo Mode not available');
      setTimeout(() => setEchoTooltip(null), 2000);
    }
  };

  // ── CONTEXT CAPTURE HANDLER ──
  const handleCaptureContext = async () => {
    if (!api?.captureContext) return;
    try {
      const ctx = await api.captureContext();
      if (!ctx) return;

      if (ctx.clipboardText) {
        addPendingAttachments([{
          id: generateId(),
          name: 'Clipboard.txt',
          path: `clipboard://manual_${Date.now()}`,
          content: ctx.clipboardText,
          tooBig: ctx.clipboardText.length > 100_000,
          size: ctx.clipboardText.length,
          ext: 'txt',
          isImage: false,
        }]);
      }

      if (ctx.screenshot) {
        const fileResult = await api.readDroppedFile(ctx.screenshot.path);
        if (fileResult) {
          addPendingAttachments([{
            ...fileResult,
            ext: fileResult.ext || 'png',
            isImage: true,
            id: generateId(),
          }]);
        }
      }
    } catch (e) {
      console.error('[ManualContext] Capture failed:', e);
    }
  };

  const hasContent = input.trim().length > 0 || pendingAttachments.length > 0;
  const isStreaming = streamState.isStreaming;
  const sendBtnState = isStreaming ? 'streaming' : hasContent ? 'ready' : 'idle';

  // ── RENDER ──
  return (
    <div className="input-bar spotlight-input-bar">
      {rejectTooltip && (
        <div className="drag-tooltip">{rejectTooltip}</div>
      )}

      {/* Left: Attach button */}
      <AttachMenu
        isOpen={showAttachMenu}
        onToggle={() => setShowAttachMenu(!showAttachMenu)}
        onClose={() => setShowAttachMenu(false)}
        onAttachFile={handleAttachFile}
        onScreenshot={handleScreenshot}
        onClipboardPaste={handleClipboardPaste}
        onCaptureContext={() => { handleCaptureContext(); setShowAttachMenu(false); }}
      />

      {/* Center: Textarea + attachments */}
      <div className="input-content-col">
        <AttachmentBar
          attachments={pendingAttachments}
          onRemove={removePendingAttachment}
        />

        <div className="input-textarea-scroll" style={{ position: 'relative', width: '100%' }}>
          {isAutocompleteOpen && (
            <AutocompleteMenu
              suggestions={suggestions}
              selectedIndex={selectedSuggestionIndex}
              onSelect={handleSelectSuggestion}
              type={autocompleteType}
            />
          )}

          <textarea
            ref={inputRef}
            value={queryValue}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onClick={activateQueryEditor}
            placeholder="Ask Hermes anything…"
            className="input-textarea"
            rows={1}
            aria-label="Ask Hermes"
            spellCheck="false"
            style={{
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              WebkitBoxShadow: 'none',
              background: 'transparent',
            }}
          />
        </div>
      </div>

      {/* Right: Action buttons */}
      <div className="input-actions-group">
        {/* Echo/Voice mode button */}
        <button
          className="input-action-btn"
          onClick={handleEchoMode}
          title="Voice mode (Ctrl+Shift+E)"
          aria-label="Start voice mode"
        >
          <Mic size={17} strokeWidth={1.7} />
        </button>

        {/* Background send button */}
        <button
          className="input-action-btn"
          onClick={handleBackgroundSend}
          disabled={!hasContent}
          title="Send in background (Ctrl+Shift+Enter)"
          aria-label="Background send"
        >
          <Zap size={16} strokeWidth={2} />
        </button>

        {/* Send button (becomes stop when streaming) */}
        <button
          className={`send-btn ${sendBtnState}`}
          onClick={isStreaming ? handleStop : handleSubmit}
          disabled={!isStreaming && !hasContent}
          title={isStreaming ? 'Stop (Escape)' : 'Send (Enter)'}
          aria-label={isStreaming ? 'Stop streaming' : 'Send message'}
        >
          {isStreaming ? (
            <Square size={14} fill="currentColor" />
          ) : (
            <ArrowUp size={16} strokeWidth={2.5} />
          )}
        </button>
      </div>
    </div>
  );
};
