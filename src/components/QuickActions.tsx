import React, { useState, useEffect } from 'react';
import { PenLine, AlignLeft, HelpCircle, Loader2 } from 'lucide-react';
import { getElectronAPI } from '../hooks/useElectronAPI';

const api = getElectronAPI();

export const QuickActions: React.FC = () => {
  const [selectedText, setSelectedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  useEffect(() => {
    if (!api?.onQuickActionText) return;
    const cleanup = api.onQuickActionText((text: string) => {
      setSelectedText(text);
    });
    return cleanup;
  }, []);

  const handleAction = async (action: string) => {
    if (!selectedText || loading) return;
    setLoading(true);
    setLoadingAction(action);

    try {
      await api?.quickActionExecute?.({ action, text: selectedText });
    } catch (e) {
      console.error('Quick action failed:', e);
    } finally {
      setLoading(false);
      setLoadingAction(null);
      api?.quickActionClose?.();
      setSelectedText('');
    }
  };

  const actions = [
    { id: 'rewrite', label: 'Rewrite', icon: PenLine },
    { id: 'summarize', label: 'Summarize', icon: AlignLeft },
    { id: 'explain', label: 'Explain', icon: HelpCircle },
  ];

  return (
    <div className="quick-actions-toolbar">
      {actions.map((action) => {
        const Icon = action.icon;
        const isActive = loadingAction === action.id;
        return (
          <button
            key={action.id}
            className={`quick-actions-btn${isActive ? ' active' : ''}`}
            onClick={() => handleAction(action.id)}
            disabled={loading || !selectedText}
          >
            {isActive ? (
              <Loader2 size={12} strokeWidth={1.5} className="spin" />
            ) : (
              <Icon size={12} strokeWidth={1.5} />
            )}
            {action.label}
          </button>
        );
      })}
    </div>
  );
};
