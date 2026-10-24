import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, HelpCircle, Command, MessageSquare, Zap, Mic } from 'lucide-react';
import { useOverlayStore } from '../store/overlayStore';

export const GuideModal: React.FC = () => {
  const { isGuideOpen, setGuideOpen } = useOverlayStore();

  if (!isGuideOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="settings-overlay"
        onClick={() => setGuideOpen(false)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{ zIndex: 1000 }}
      >
        <motion.div
          className="settings-panel"
          style={{ padding: 0, display: 'flex', flexDirection: 'column' }}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', mass: 0.7, stiffness: 300, damping: 30 }}
        >
          {/* Header */}
          <div className="settings-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={16} className="text-muted" />
              <div className="settings-panel-title">Hermes Guide</div>
            </div>
            <button className="settings-panel-close" onClick={() => setGuideOpen(false)}>
              <X />
            </button>
          </div>

          {/* Content */}
          <div className="settings-panel-body" style={{ padding: '24px' }}>
            <div style={{ marginBottom: '32px' }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '15px' }}>Welcome to Hermes</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
                Hermes is a desktop intelligence surface designed to be the thinnest possible membrane between human thought and machine capability. It lives on top of your workflow, ready exactly when you need it.
              </p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: '16px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Command size={16} /> Keyboard Shortcuts
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Toggle Overlay</span>
                  <kbd style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '12px', color: 'var(--text-muted)' }}>Ctrl + Space</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Command Palette</span>
                  <kbd style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '12px', color: 'var(--text-muted)' }}>Ctrl + K</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>New Session</span>
                  <kbd style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '12px', color: 'var(--text-muted)' }}>Ctrl + N</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Voice Mode</span>
                  <kbd style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '12px', color: 'var(--text-muted)' }}>Ctrl + E</kbd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Quit Completely</span>
                  <kbd style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-secondary)', fontSize: '12px', color: 'var(--text-muted)' }}>Ctrl + Shift + F4</kbd>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: '12px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={16} /> Context Capture
              </h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5, marginBottom: '8px' }}>
                Click the scanner icon in the input bar to automatically capture your clipboard text and a screenshot of your primary display. This instantly provides Hermes with context about what you're looking at.
              </p>
            </div>

            <div>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: '12px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Mic size={16} /> Echo Mode (Voice)
              </h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
                Activate Echo Mode to talk naturally with Hermes. Use the wake word "Hey Hermes" (if enabled in Settings) or press the microphone button. Echo mode uses high-speed streaming for minimal latency.
              </p>
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
