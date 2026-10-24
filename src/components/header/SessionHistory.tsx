import React, { useState, useRef, useEffect } from 'react';
import { Clock, Search, Loader2 } from 'lucide-react';
import { useOverlayStore } from '../../store/overlayStore';
import { Popover } from '../ui/Popover';
import { getElectronAPI } from '../../hooks/useElectronAPI';

const api = getElectronAPI();

export const SessionHistory: React.FC = () => {
  const { hydrateSession } = useOverlayStore();
  const [isOpen, setIsOpen] = useState(false);
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);

  const fetchSessions = React.useCallback((query: string) => {
    setSessionsLoading(true);
    if (query.trim().length > 0 && api?.searchSessions) {
      api.searchSessions(query.trim()).then((data: any[]) => {
        setSessionsList(data);
        setSessionsLoading(false);
      }).catch(() => {
        setSessionsLoading(false);
        if (api?.listSessions) {
          api.listSessions().then((data: any[]) => {
            setSessionsList(data);
            setSessionsLoading(false);
          }).catch(() => setSessionsLoading(false));
        } else {
          setSessionsLoading(false);
        }
      });
    } else if (api?.listSessions) {
      api.listSessions().then((data: any[]) => {
        setSessionsList(data);
        setSessionsLoading(false);
      }).catch(() => setSessionsLoading(false));
    } else {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSessions('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchSessions(searchQuery);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery, isOpen]);

  const handleSelectSession = async (sessionId: string) => {
    if (!api?.getSession) return;
    setSessionsLoading(true);
    try {
      const messages = await api.getSession(sessionId);
      hydrateSession(sessionId, messages);
      setIsOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSessionsLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        className={`header-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="History"
        aria-label="View past sessions"
      >
        <Clock size={14} />
      </button>

      <Popover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={triggerRef}
        className="model-popover history-popover"
        style={{ right: -128, left: 'auto', top: 32, width: 300 }}
      >
        <div className="popover-section-label">
          <Clock size={10} />
          <span>Session History</span>
        </div>

        <div className="session-search-bar">
          <Search size={11} className="session-search-icon" />
          <input
            type="text"
            className="session-search-input"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="model-list-scroll">
          {sessionsLoading && sessionsList.length === 0 ? (
            <div className="popover-empty">
              <Loader2 size={14} className="spin" style={{ display: 'inline-block', marginRight: 6 }} />
              {searchQuery.trim() ? 'Searching...' : 'Loading sessions...'}
            </div>
          ) : sessionsList.length === 0 ? (
            <div className="popover-empty">
              {searchQuery.trim() ? 'No sessions found.' : 'No recent sessions found.'}
            </div>
          ) : (
            sessionsList.map((s) => (
              <button
                key={s.id}
                className="model-popover-item model-item"
                onClick={() => handleSelectSession(s.id)}
                role="option"
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
                  <span className="model-item-name" style={{ fontWeight: 500 }}>{s.title}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-disabled)', marginTop: '2px' }}>
                    {s.started_at ? new Date(s.started_at).toLocaleString() : ''} · {s.message_count} msg
                  </span>
                  {s.snippet && (
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-secondary)',
                        marginTop: '4px',
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {s.snippet.replace(/<[^>]+>/g, '')}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
};
