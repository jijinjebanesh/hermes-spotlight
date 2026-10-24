import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOverlayStore } from '../../store/overlayStore';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

interface SessionRecord {
  id: string;
  title?: string;
  started_at?: number;
  message_count?: number;
  snippet?: string;
}

interface SessionGroup {
  label: string;
  sessions: SessionRecord[];
}

const stripMarkup = (value: string) => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const sessionDate = (session: SessionRecord) => {
  const date = Number(session.started_at || 0);
  return date > 0 ? new Date(date) : null;
};

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const groupLabelFor = (session: SessionRecord) => {
  const date = sessionDate(session);
  if (!date) return 'Older';
  const today = dayStart(new Date());
  const sessionDay = dayStart(date);
  const dayDelta = Math.round((today - sessionDay) / 86_400_000);
  if (dayDelta <= 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < 7) return 'Previous 7 days';
  return 'Older';
};

const formatSessionTime = (session: SessionRecord) => {
  const date = sessionDate(session);
  if (!date) return 'No timestamp';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const getSessionTitle = (session: SessionRecord) => session.title?.trim() || 'New session';

export const SessionHistorySidebar: React.FC = () => {
  const { hydrateSession, newSession, sessionId } = useOverlayStore();
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLButtonElement[]>([]);
  const requestId = useRef(0);
  const loadingRef = useRef(false);
  const debounceTimer = useRef<NodeJS.Timeout>();

  const loadSessions = useCallback(async (query: string) => {
    if (!api || loadingRef.current) return;
    loadingRef.current = true;
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError('');
    try {
      const result = query.trim() && api.searchSessions
        ? await api.searchSessions(query.trim())
        : await api.listSessions();
      if (currentRequest !== requestId.current) return;
      setSessions(Array.isArray(result) ? result : []);
      setSelectedIndex(-1);
    } catch {
      if (currentRequest !== requestId.current) return;
      setSessions([]);
      setError('Session history is unavailable right now.');
    } finally {
      if (currentRequest === requestId.current) {
        setIsLoading(false);
        loadingRef.current = false;
      }
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => loadSessions(searchQuery), searchQuery ? 120 : 0);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [isOpen, loadSessions, searchQuery]);

  const groups = useMemo<SessionGroup[]>(() => {
    if (searchQuery.trim()) return [{ label: 'Search results', sessions }];
    const order = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];
    return order
      .map((label) => ({ label, sessions: sessions.filter((session) => groupLabelFor(session) === label) }))
      .filter((group) => group.sessions.length > 0);
  }, [searchQuery, sessions]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // Global escape
      if (event.key === 'Escape') {
        setIsOpen(false);
        return;
      }
      // Only handle nav keys when search input is NOT focused
      if (event.target instanceof HTMLInputElement) return;

      const visibleGroups = groups.flatMap(g => g.sessions);
      const count = visibleGroups.length;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, count - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < count) {
            handleSelectSession(visibleGroups[selectedIndex]);
          }
          break;
        case 'Home':
          event.preventDefault();
          setSelectedIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setSelectedIndex(count - 1);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, groups, selectedIndex]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) setTimeout(() => searchInputRef.current?.focus(), 80);
  }, [isOpen]);

  // Scroll selected into view
  useEffect(() => {
    if (selectedIndex >= 0 && scrollRef.current && itemsRef.current[selectedIndex]) {
      itemsRef.current[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 10);
  }, []);

  const handleSelectSession = async (session: SessionRecord) => {
    if (!api?.getSession) return;
    const selectRequestId = ++requestId.current;
    setIsLoading(true);
    try {
      const messages = await api.getSession(session.id);
      if (selectRequestId !== requestId.current) return;
      if (Array.isArray(messages)) {
        hydrateSession(session.id, messages);
        setIsOpen(false);
      }
    } catch {
      if (selectRequestId !== requestId.current) return;
      setError('Could not open that session.');
    } finally {
      if (selectRequestId === requestId.current) setIsLoading(false);
    }
  };

  const handleNewSession = () => { newSession(); setIsOpen(false); };

  const handleClearHistory = async () => {
    if (!api?.clearAllSessions || isClearing) return;
    const confirmed = window.confirm('Clear all saved chat sessions? This cannot be undone.');
    if (!confirmed) return;
    setIsClearing(true);
    try { if (await api.clearAllSessions()) setSessions([]); }
    finally { setIsClearing(false); }
  };

  return (
    <>
      <button
        className={`history-launcher${isOpen ? ' is-active' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? 'Close session history' : 'Open session history'}
        title="Session history (Ctrl+H)"
      >
        <span className="history-launcher-glyph">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="12" x2="10" y2="12" />
          </svg>
        </span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="session-history-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="session-history-backdrop" onClick={() => setIsOpen(false)} />

            <motion.aside
              className="session-history-sidebar"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.8 }}
            >
              {/* Collapsible Header */}
              <div className={`session-history-header ${isScrolled ? 'scrolled' : ''}`}>
                <div className="session-history-header-top">
                  <div className="session-history-title-row">
                    <span className="session-history-title-icon">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="2" y1="4" x2="14" y2="4" />
                        <line x1="2" y1="12" x2="10" y2="12" />
                      </svg>
                    </span>
                    <h2>History</h2>
                  </div>
                  <div className="session-history-header-actions">
                    <button className="session-history-icon-btn" onClick={handleNewSession} title="New chat (Ctrl+N)">
                      <Plus size={15} />
                    </button>
                    <button
                      className="session-history-icon-btn"
                      onClick={() => loadSessions(searchQuery)}
                      disabled={isLoading}
                      title="Refresh"
                    >
                      <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
                    </button>
                    <button className="session-history-icon-btn close" onClick={() => setIsOpen(false)} title="Close (Esc)">
                      <X size={15} />
                    </button>
                  </div>
                </div>

                <div className="session-history-search-wrapper">
                  <Search size={14} className="session-history-search-icon" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search..."
                    className="session-history-search-input"
                  />
                  {searchQuery && (
                    <button className="session-history-search-clear" onClick={() => setSearchQuery('')}>
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable List */}
              <div className="session-history-scroll" ref={scrollRef} onScroll={handleScroll}>
                <AnimatePresence mode="wait">
                  {isLoading && sessions.length === 0 ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="session-history-state"
                    >
                      <Loader2 size={18} className="spin" />
                      <span>Loading history...</span>
                    </motion.div>
                  ) : error ? (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="session-history-state error"
                    >
                      <span>{error}</span>
                      <button onClick={() => loadSessions(searchQuery)}>Try again</button>
                    </motion.div>
                  ) : groups.length === 0 ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="session-history-state"
                    >
                      <MessageSquare size={20} />
                      <strong>{searchQuery ? 'No matches' : 'No saved chats yet'}</strong>
                      <span>{searchQuery ? 'Try different keywords' : 'Your conversations appear here'}</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="list"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      {groups.map((group) => (
                        <section className="session-history-group" key={group.label}>
                          <div className="session-history-group-label">{group.label}</div>
                          <div className="session-history-group-list">
                            {group.sessions.map((session, idx) => {
                              const isActive = session.id === sessionId;
                              const snippet = session.snippet ? stripMarkup(session.snippet) : '';
                              const globalIdx = sessions.indexOf(session);
                              return (
                                <motion.button
                                  key={session.id}
                                  initial={{ opacity: 0, x: -8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.02 }}
                                  className={`session-history-item${isActive ? ' is-active' : ''}${selectedIndex === globalIdx ? ' focused' : ''}`}
                                  onClick={() => handleSelectSession(session)}
                                  onMouseEnter={() => setSelectedIndex(globalIdx)}
                                  disabled={isLoading}
                                >
                                  <span className="session-history-item-icon">
                                    <MessageSquare size={13} />
                                  </span>
                                  <span className="session-history-item-content">
                                    <strong>{getSessionTitle(session)}</strong>
                                    <span className="session-history-item-meta">
                                      {formatSessionTime(session)} · {session.message_count || 0} msgs
                                    </span>
                                    {snippet && <em>{snippet}</em>}
                                  </span>
                                  {isActive && <span className="session-history-active-dot" />}
                                </motion.button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              {sessions.length > 0 && (
                <div className="session-history-footer">
                  <span>{sessions.length} sessions</span>
                  <button
                    className={`session-history-clear-btn${isClearing ? ' loading' : ''}`}
                    onClick={() => handleClearHistory()}
                    disabled={isClearing}
                  >
                    <Trash2 size={12} />
                    {isClearing ? 'Clearing...' : 'Clear all'}
                  </button>
                </div>
              )}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};