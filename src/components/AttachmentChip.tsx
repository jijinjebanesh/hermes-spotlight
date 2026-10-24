import React, { useEffect, useState, useRef, MouseEvent, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AttachedFile } from '../store/overlayStore';
import { File, Code, Image as ImageIcon, FileText, Sheet, X } from 'lucide-react';

interface AttachmentChipProps {
  file: AttachedFile;
  onRemove?: () => void;
  variant: 'pending' | 'sent';
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getIcon = (ext: string, isImage: boolean) => {
  if (isImage) return <ImageIcon size={14} />;
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt'].includes(ext)) {
    return <Code size={14} />;
  }
  if (['txt', 'md', 'log'].includes(ext)) return <FileText size={14} />;
  if (['pdf'].includes(ext)) return <FileText size={14} />;
  if (['doc', 'docx'].includes(ext)) return <FileText size={14} />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <Sheet size={14} />;
  return <File size={14} />;
};

const getKind = (ext: string, isImage: boolean): string => {
  if (isImage) return 'Image preview';
  if (['pdf'].includes(ext)) return 'PDF document';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'Document';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Spreadsheet';
  if (['ppt', 'pptx'].includes(ext)) return 'Presentation';
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'html', 'css', 'scss', 'less', 'sql', 'graphql'].includes(ext)) return 'Code file';
  if (['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) return 'Text file';
  return ext ? `${ext.toUpperCase()} file` : 'File';
};

export const AttachmentChip: React.FC<AttachmentChipProps> = ({ file, onRemove, variant }) => {
  const isPending = variant === 'pending';
  const [imgError, setImgError] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  
  // Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleWheel = (e: WheelEvent) => {
    if (!file.isImage) return;
    e.preventDefault();
    setScale(s => Math.min(Math.max(0.1, s - e.deltaY * 0.005), 10));
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!file.isImage) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };
  
  const closePreview = () => {
    setIsPreviewOpen(false);
    resetZoom();
  };

  useEffect(() => {
    if (!isPreviewOpen) return;
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closePreview();
    };
    // Capture phase keeps the app-level Escape shortcut from hiding the
    // overlay while this modal is the active surface.
    window.addEventListener('keydown', dismissOnEscape, true);
    return () => window.removeEventListener('keydown', dismissOnEscape, true);
  }, [isPreviewOpen]);
  
  const imgSrc = (file.content && file.content.startsWith('data:image')) 
    ? file.content 
    : `local-file://preview?path=${encodeURIComponent(file.path)}`;
  const meta = file.tooBig ? 'Path only' : formatSize(file.size);

  return (
    <div className={`attachment-chip attachment-chip--${variant} ${file.isImage ? 'attachment-chip--image' : 'attachment-chip--file'}`}>
      {file.isImage && !imgError ? (
        <div 
          className="attachment-chip__preview attachment-chip__preview--image" 
          onClick={() => setIsPreviewOpen(true)}
          style={{ cursor: 'pointer' }}
          title="Click to preview"
        >
          <img
            src={imgSrc}
            alt={file.name}
            className="attachment-chip__thumbnail"
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        <div 
          className="attachment-chip__preview attachment-chip__preview--file"
          onClick={() => { if (file.content) setIsPreviewOpen(true); }}
          style={{ cursor: file.content ? 'pointer' : 'default' }}
          title={file.content ? "Click to preview" : undefined}
        >
          <div className="attachment-chip__icon">
            {getIcon(file.ext, file.isImage)}
          </div>
        </div>
      )}

      {/* Image chips: preview only, no text. File chips: full info */}
      {(
        <div 
          className="attachment-chip__info"
          onClick={() => { if (file.content) setIsPreviewOpen(true); }}
          style={{ cursor: file.content ? 'pointer' : 'default' }}
          title={file.content ? "Click to preview" : undefined}
        >
          <span className="attachment-chip__name" title={file.name}>{file.name}</span>
          <span className="attachment-chip__meta">
            <span>{getKind(file.ext, file.isImage)}</span>
            <span aria-hidden="true">•</span>
            <span>{meta}</span>
          </span>
        </div>
      )}

      {isPending && onRemove && (
        <button className="attachment-chip__remove" onClick={onRemove} title="Remove attachment">
          <X size={12} strokeWidth={2.5} />
        </button>
      )}

      {isPreviewOpen && (
        createPortal(
          <div className="image-preview-modal" onClick={closePreview}>
            <div className="image-preview-modal__backdrop" />
            <div 
              className="image-preview-modal__content" 
              onClick={(e) => e.stopPropagation()}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={!file.isImage ? { 
                width: '800px', 
                background: 'var(--surface-bg)', 
                padding: 'var(--space-3)', 
                border: '1px solid var(--border-secondary)'
              } : { cursor: isDragging ? 'grabbing' : 'grab', overflow: 'visible' }}
            >
              {file.isImage ? (
                <img 
                  src={imgSrc} 
                  alt={file.name} 
                  className="image-preview-modal__img"
                  draggable={false}
                  style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                  }}
                />
              ) : (
                <div style={{ width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
                  <h3 style={{ marginTop: 0, marginBottom: 'var(--space-2)', color: 'var(--text-primary)', fontSize: 'var(--text-lg)' }}>
                    {file.name}
                  </h3>
                  <pre style={{ 
                    margin: 0, 
                    whiteSpace: 'pre-wrap', 
                    wordBreak: 'break-word', 
                    color: 'var(--text-primary)', 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: 'var(--text-sm)',
                    lineHeight: '1.5'
                  }}>
                    {file.content}
                  </pre>
                </div>
              )}
              <button className="image-preview-modal__close" onClick={closePreview}>
                <X size={24} strokeWidth={2} />
              </button>
            </div>
          </div>,
          document.body,
        )
      )}
    </div>
  );
};
