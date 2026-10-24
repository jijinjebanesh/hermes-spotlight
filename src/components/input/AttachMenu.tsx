import React, { useRef } from 'react';
import { Plus, Image as ImageIcon, Camera, ClipboardPaste, Monitor } from 'lucide-react';
import { Popover } from '../ui/Popover';

interface AttachMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onAttachFile: () => void;
  onScreenshot: () => void;
  onClipboardPaste: () => void;
  onCaptureContext?: () => void;
}

export const AttachMenu: React.FC<AttachMenuProps> = ({ 
  isOpen, 
  onToggle, 
  onClose, 
  onAttachFile, 
  onScreenshot,
  onClipboardPaste,
  onCaptureContext
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="attach-container" style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        className={`attach-toggle-btn${isOpen ? ' active' : ''}`}
        onClick={onToggle}
        title="Attach file, screenshot, or clipboard"
      >
        <Plus size={16} strokeWidth={2.5} />
      </button>
      
      <Popover
        isOpen={isOpen}
        onClose={onClose}
        triggerRef={triggerRef}
        className="attach-menu-popover"
        style={{ left: 0, top: 'calc(100% + 8px)', bottom: 'auto' }}
      >
        <div className="attach-menu">
          <div className="attach-menu-heading">
            <span>Add to your request</span>
            <small>Context Hermes can use</small>
          </div>
          <button className="attach-menu-item" onClick={onAttachFile}>
            <span className="attach-menu-icon"><ImageIcon size={16} /></span>
            <span className="attach-menu-copy">
              <strong>Choose file</strong>
              <small>Images, documents and code</small>
            </span>
          </button>
          <button className="attach-menu-item" onClick={onClipboardPaste}>
            <span className="attach-menu-icon"><ClipboardPaste size={16} /></span>
            <span className="attach-menu-copy">
              <strong>Paste clipboard</strong>
              <small>Attach copied text as context</small>
            </span>
          </button>
          <button className="attach-menu-item" onClick={onScreenshot}>
            <span className="attach-menu-icon"><Monitor size={16} /></span>
            <span className="attach-menu-copy">
              <strong>Capture screen</strong>
              <small>Add a screenshot as context</small>
            </span>
            <Camera size={14} className="attach-menu-trailing" />
          </button>
          {onCaptureContext && (
            <button className="attach-menu-item" onClick={onCaptureContext}>
              <span className="attach-menu-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 7V2h5" /><path d="M22 7V2h-5" /><path d="M2 17v5h5" /><path d="M22 17v5h-5" /><rect x="7" y="7" width="10" height="10" rx="1" />
                </svg>
              </span>
              <span className="attach-menu-copy">
                <strong>Capture context</strong>
                <small>Grab clipboard + active window</small>
              </span>
            </button>
          )}
          <div className="attach-menu-footer">Files stay attached until you send</div>
        </div>
      </Popover>
    </div>
  );
};
