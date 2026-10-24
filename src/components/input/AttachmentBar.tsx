import React from 'react';
import { AttachmentChip } from '../AttachmentChip';
import { AttachedFile } from '../../store/overlayStore';

interface AttachmentBarProps {
  attachments: AttachedFile[];
  onRemove: (id: string) => void;
}

export const AttachmentBar: React.FC<AttachmentBarProps> = ({ attachments, onRemove }) => {
  if (attachments.length === 0) return null;
  
  return (
    <div className="attachment-tray">
      {attachments.map((file) => (
        <AttachmentChip
          key={file.id}
          file={file}
          variant="pending"
          onRemove={() => onRemove(file.id)}
        />
      ))}
    </div>
  );
};
