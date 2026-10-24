import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  FolderOpen,
  Globe2,
  PenLine,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { ToolCall } from '../../store/overlayStore';
import { CodeBlock } from './CodeBlock';

interface ToolCallBlockProps {
  tool: ToolCall;
}

const getToolVisual = (name: string) => {
  const tool = name.toLowerCase();
  if (tool.includes('terminal') || tool.includes('shell') || tool.includes('command')) return { Icon: Terminal, verb: 'Ran a command' };
  if (tool.includes('search') || tool.includes('find') || tool.includes('grep')) return { Icon: Search, verb: 'Searched project files' };
  if (tool.includes('web') || tool.includes('browser') || tool.includes('url')) return { Icon: Globe2, verb: 'Looked something up' };
  if (tool.includes('write') || tool.includes('edit') || tool.includes('patch')) return { Icon: PenLine, verb: 'Updated a file' };
  if (tool.includes('read') || tool.includes('file')) return { Icon: FolderOpen, verb: 'Read a file' };
  return { Icon: Wrench, verb: 'Used a tool' };
};

const summarizeCommand = (tool: ToolCall): string => {
  const raw = tool.command?.trim() || '';
  if (!raw) return tool.name || 'Tool activity';

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed) {
      const candidate = parsed.command || parsed.path || parsed.query || parsed.url || parsed.text;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  } catch {
    // The command is already a human-readable value.
  }

  return raw.replace(/\s+/g, ' ').trim();
};

export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ tool }) => {
  const [expanded, setExpanded] = useState(false);
  const { Icon, verb } = getToolVisual(tool.name);
  const summary = summarizeCommand(tool);
  const status = tool.status || 'pending';
  
  // Custom rendering for 'todo' tool
  const isTodoTool = tool.name === 'todo' || tool.name === 'manage_tasks';
  let parsedTodos = null;
  if (isTodoTool && tool.output) {
    try {
      const parsed = JSON.parse(tool.output);
      if (parsed && Array.isArray(parsed.todos)) {
        parsedTodos = parsed.todos;
      }
    } catch {
      // Not valid JSON, fallback to raw text
    }
  }

  // Determine appropriate language for output code block
  const getOutputLanguage = (name: string) => {
    const n = (name || '').toLowerCase();
    if (n.includes('patch') || n.includes('replace') || n.includes('edit') || n.includes('diff')) return 'diff';
    if (n.includes('cmd') || n.includes('run') || n.includes('terminal') || n.includes('shell') || n.includes('execute')) return 'bash';
    if (n.includes('json')) return 'json';
    return 'text';
  };
  const outputLanguage = getOutputLanguage(tool.name);

  // Format request cleanly if it's JSON
  let formattedRequest = tool.command || '';
  try {
    const parsed = JSON.parse(formattedRequest);
    formattedRequest = JSON.stringify(parsed, null, 2);
  } catch {
    // leave as is
  }

  const hasDetail = Boolean(tool.command || tool.output);

  return (
    <div className="tool-call-card">
      <button
        type="button"
        className={`tool-call-pill tool-call-pill--${status}`}
        onClick={() => hasDetail && setExpanded((value) => !value)}
        aria-expanded={hasDetail ? expanded : undefined}
        aria-label={`${expanded ? 'Hide' : 'Show'} details for ${tool.name || 'tool activity'}`}
      >
        <span className="tool-call-icon"><Icon size={14} strokeWidth={2.1} /></span>
        <span className="tool-call-copy">
          <span className="tool-call-verb">{verb}</span>
          <span className="tool-call-summary">{summary}</span>
        </span>
        {hasDetail && (
          <ChevronDown className={`tool-call-chevron${expanded ? ' is-expanded' : ''}`} size={14} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && hasDetail && (
          <motion.div
            className="tool-call-detail"
            initial={{ height: 0, opacity: 0, y: -4 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {isTodoTool && parsedTodos ? (
              <div className="todo-tool-list" style={{ marginTop: '4px', padding: '8px 12px', background: 'var(--surface-code)', borderRadius: 'var(--radius-tool)' }}>
                {parsedTodos.map((task: any, idx: number) => {
                  const isDone = task.status === 'completed' || task.status === 'done';
                  const isProgress = task.status === 'in_progress';
                  const isPending = !isDone && !isProgress;
                  return (
                    <div key={task.id || idx} className={`styled-task ${isDone ? 'task-done' : isProgress ? 'task-progress' : 'task-pending'}`} style={{ marginBottom: '8px' }}>
                      <span className="task-icon">
                        {isDone && <span className="task-icon-done">✓</span>}
                        {isProgress && <span className="task-icon-progress" />}
                        {isPending && <span className="task-icon-pending" />}
                      </span>
                      <span className="task-content" style={{ fontSize: '13px' }}>{task.content || task.title}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="tool-detail-grid">
                {formattedRequest && (
                  <div className="tool-detail-section">
                    <div className="tool-detail-label">Request Arguments</div>
                    <CodeBlock code={formattedRequest} language="json" />
                  </div>
                )}
                {tool.output && (
                  <div className="tool-detail-section">
                    <div className="tool-detail-label">Output</div>
                    <CodeBlock code={tool.output} language={outputLanguage} />
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
