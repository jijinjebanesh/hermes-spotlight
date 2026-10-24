import React from 'react';
import type { AttachedFile } from '../../store/overlayStore';

interface AttachmentGalleryProps {
  files: AttachedFile[];
}

/**
 * Masonry-style 2-column grid for multiple image attachments
 * inside a sent message. Renders each image as a thumbnail card
 * with filename overlay. Non-image files fall through to
 * regular AttachmentChip rendering in MessageBubble.
 */
export const AttachmentGallery: React.FC<AttachmentGalleryProps> = ({ files }) => {
  const images = files.filter(f => f.isImage);
  const others = files.filter(f => !f.isImage);

  if (images.length === 0 && others.length === 0) return null;

  return (
    <div className="attachment-gallery">
      {images.length > 0 && (
        <div className="attachment-gallery__images">
          {images.map((file) => (
            <div key={file.id} className="attachment-gallery__card">
              <img
                src={`local-file://preview?path=${encodeURIComponent(file.path)}`}
                alt={file.name}
                className="attachment-gallery__thumbnail"
                loading="lazy"
              />
              {images.length <= 4 && (
                <span className="attachment-gallery__label">{file.name}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};