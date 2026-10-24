import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Eye,
  FileText,
  FolderSearch,
  Globe2,
  Image,
  Keyboard,
  LoaderCircle,
  MousePointer2,
  RotateCcw,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { DiffBlock } from './DiffBlock';
import { CodeBlock } from './CodeBlock';
import { terminal_output_text } from '../../tool-parser';
import {
  ToolCompleteSegment,
  ToolStartSegment,
  formatToolCompleteForDisplay,
  formatToolStartForDisplay,
} from './toolDisplay';

type ToolActivitySegment = ToolStartSegment | ToolCompleteSegment;

interface ToolActivityEntry {
  id: string;
  name: string;
  args: Record<string, any>;
  start?: ToolStartSegment;
  complete?: ToolCompleteSegment;
}

const getEntries = (segments: ToolActivitySegment[]): ToolActivityEntry[] => {
  const entries: ToolActivityEntry[] = [];
  const byId = new Map<string, ToolActivityEntry>();

  segments.forEach((segment, index) => {
    const explicitId = segment.toolId;
    const fallbackEntry = !explicitId && segment.type === 'tool_complete'
      ? [...entries].reverse().find((item) => item.name === segment.name && !item.complete)
      : undefined;
    const id = explicitId || fallbackEntry?.id || `${segment.name}-${index}`;
    let entry = (explicitId && byId.get(explicitId)) || fallbackEntry || byId.get(id);

    if (!entry) {
      entry = {
        id,
        name: segment.name,
        args: segment.args || {},
      };
      entries.push(entry);
    }

    byId.set(id, entry);
    entry.name = segment.name || entry.name;
    entry.args = segment.args || entry.args;
    if (segment.type === 'tool_start') entry.start = segment;
    else entry.complete = segment;
  });

  return entries;
};

const getToolTitle = (name: string, args: Record<string, any>): string => {
  const tool = (name || '').toLowerCase();
  if (tool === 'browser_exec') return 'Browser action';
  if (tool === 'browser_navigate') return 'Open in browser';
  if (tool === 'browser_snapshot') return 'Read web page';
  if (tool === 'browser_click') return 'Click page element';
  if (tool === 'browser_type') return 'Enter text';
  if (tool === 'browser_scroll') return 'Scroll web page';
  if (tool === 'browser_back') return 'Go back';
  if (tool === 'browser_press') return 'Press a key';
  if (tool === 'browser_get_images') return 'Find page images';
  if (tool === 'browser_vision') return 'Analyze web page';
  if (tool === 'web_search' || tool === 'search_web') return 'Web search';
  if (tool === 'skills_list') return 'Browse available skills';
  if (tool === 'skill_view') return args.name ? `Read ${args.name}` : 'Read skill instructions';
  if (tool === 'skill_manage') return args.name ? `Update ${args.name}` : 'Update a skill';
  if (tool === 'read_file') return 'Read a file';
  if (tool === 'write_file') return 'Update a file';
  if (tool === 'search_files') return 'Search project files';
  if (tool === 'execute_code') {
    return String(args.language || '').toLowerCase() === 'python' ? 'Python' : 'Run code';
  }
  if (tool === 'terminal') return 'Terminal';
  if (tool === 'delegate_task') return 'Delegate a task';
  if (tool === 'memory') return 'Check memory';

  return (name || 'Tool action')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const getToolIcon = (name: string) => {
  const tool = (name || '').toLowerCase();
  if (tool.includes('search') || tool.includes('grep') || tool.includes('find')) return Search;
  if (tool.includes('click')) return MousePointer2;
  if (tool.includes('type') || tool.includes('press')) return Keyboard;
  if (tool.includes('scroll')) return ArrowDown;
  if (tool.includes('image')) return Image;
  if (tool.includes('vision') || tool.includes('snapshot')) return Eye;
  if (tool.includes('skill')) return BookOpen;
  if (tool.includes('terminal') || tool.includes('shell') || tool.includes('command') || tool.includes('execute')) return Terminal;
  if (tool.includes('read') || tool.includes('write') || tool.includes('file') || tool.includes('patch')) return FileText;
  if (tool.includes('browser') || tool.includes('web') || tool.includes('url')) return Globe2;
  if (tool.includes('memory')) return FolderSearch;
  if (tool.includes('back')) return RotateCcw;
  return Wrench;
};

const getDuration = (entry: ToolActivityEntry): number | undefined => {
  if (!entry.complete) return undefined;
  const duration = entry.complete.duration_s ?? entry.complete.durationS;
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined;
};

const getToolDetail = (entry: ToolActivityEntry): string => {
  const completeDisplay = entry.complete ? formatToolCompleteForDisplay(entry.complete) : null;
  const startDisplay = entry.start ? formatToolStartForDisplay(entry.start) : null;
  return entry.complete?.summary || completeDisplay?.detail || startDisplay?.detail || '';
};

/** Return the actual stdout for terminal calls, including older wrapped results. */
const getTerminalOutput = (entry: ToolActivityEntry): string | null => {
  if (entry.name.toLowerCase() !== 'terminal' || !entry.complete) return null;
  return terminal_output_text(entry.complete.result);
};

const ToolActivityStep: React.FC<{
  entry: ToolActivityEntry;
  index: number;
  isLast: boolean;
}> = ({ entry, index, isLast }) => {
  const [diffExpanded, setDiffExpanded] = useState(false);
  const StepIcon = getToolIcon(entry.name);
  const title = getToolTitle(entry.name, entry.args);
  const detail = getToolDetail(entry);
  const isRunning = !entry.complete;
  const isError = Boolean(entry.complete?.error);
  const duration = getDuration(entry);
  const diffText = entry.complete?.inlineDiff || entry.complete?.inline_diff;
  const diffLines = entry.complete?.diffLines;
  const hasDiff = Boolean(diffText || diffLines?.length);
  const terminalOutput = getTerminalOutput(entry);

  return (
    <li className={`hermes-tool-step${isRunning ? ' is-running' : ''}${isError ? ' has-error' : ''}`}>
      <span className="hermes-tool-step__track" aria-hidden="true">
        <span className="hermes-tool-step__number">{index + 1}</span>
        {!isLast && <span className="hermes-tool-step__connector" />}
      </span>

      <span className="hermes-tool-step__icon" aria-hidden="true">
        <StepIcon size={18} strokeWidth={1.8} />
      </span>

      <span className="hermes-tool-step__copy">
        <span className="hermes-tool-step__title">{title}</span>
        {detail && <span className="hermes-tool-step__detail" title={detail}>{detail}</span>}
        {terminalOutput && (
          <div className="hermes-tool-step__output">
            <CodeBlock code={terminalOutput} language="text" />
          </div>
        )}
        {isError && entry.complete?.error && (
          <span className="hermes-tool-step__error">{entry.complete.error}</span>
        )}
        {hasDiff && (
          <button
            type="button"
            className="hermes-tool-step__diff-toggle"
            onClick={() => setDiffExpanded((value) => !value)}
            aria-expanded={diffExpanded}
          >
            {diffExpanded ? 'Hide changes' : 'Review changes'}
          </button>
        )}
        <AnimatePresence initial={false}>
          {diffExpanded && hasDiff && (
            <motion.div
              className="hermes-tool-step__diff"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <DiffBlock content={diffText || ''} diffLines={diffLines} />
            </motion.div>
          )}
        </AnimatePresence>
      </span>

      <span className="hermes-tool-step__timing" aria-label={isError ? 'Failed' : isRunning ? 'In progress' : duration != null ? `Completed in ${duration.toFixed(1)} seconds` : 'Completed'}>
        {isError ? (
          <CircleAlert size={13} strokeWidth={2} />
        ) : isRunning ? (
          <LoaderCircle size={13} strokeWidth={2} />
        ) : (
          <Check size={13} strokeWidth={2.2} />
        )}
        <span>{isError ? 'Failed' : isRunning ? 'Working' : duration != null ? `${duration.toFixed(1)}s` : 'Done'}</span>
      </span>
    </li>
  );
};

export const ToolActivityPill: React.FC<{ segments: ToolActivitySegment[]; compact?: boolean }> = ({ segments, compact = false }) => {
  const entries = segments?.length ? getEntries(segments) : [];
  const isRunning = entries.some((entry) => !entry.complete);
  const [expanded, setExpanded] = useState(isRunning);
  const previousRunningState = useRef(isRunning);
  const stepsId = useId();

  useEffect(() => {
    if (previousRunningState.current !== isRunning) {
      setExpanded(isRunning);
      previousRunningState.current = isRunning;
    }
  }, [isRunning]);

  if (!entries.length) return null;

  const hasError = entries.some((entry) => Boolean(entry.complete?.error));
  const durations = entries.map(getDuration).filter((duration): duration is number => duration != null);
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const cardTitle = entries.length === 1 ? getToolTitle(entries[0].name, entries[0].args) : 'Using tools';
  const cardDetail = entries.length === 1
    ? getToolDetail(entries[0])
    : `${entries.length} actions`;
  const statusLabel = isRunning
    ? 'In progress'
    : hasError
      ? 'Failed'
      : durations.length === entries.length && durations.length > 0
        ? `Completed in ${totalDuration.toFixed(1)}s`
        : 'Completed';
  const visibleStatusLabel = isRunning ? 'Working' : hasError ? 'Failed' : 'Done';
  const StatusIcon = isRunning ? LoaderCircle : hasError ? CircleAlert : Check;

  return (
    <section className={`hermes-tool-card${compact ? ' is-compact' : ''}${isRunning ? ' is-running' : ''}${hasError ? ' has-error' : ''}`} aria-label="Tool activity">
      <button
        type="button"
        className="hermes-tool-card__header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={stepsId}
      >
        <span className="hermes-tool-card__heading">
          <span className="hermes-tool-card__mark" aria-hidden="true"><Sparkles size={17} strokeWidth={1.8} /></span>
          <span className="hermes-tool-card__heading-copy">
            <span className="hermes-tool-card__title">{cardTitle}</span>
            {cardDetail && <span className="hermes-tool-card__subtitle" title={cardDetail}>{cardDetail}</span>}
          </span>
          {expanded ? <ChevronUp className="hermes-tool-card__chevron" size={16} /> : <ChevronDown className="hermes-tool-card__chevron" size={16} />}
        </span>
        <span className="hermes-tool-card__status" role="status" aria-live="polite" aria-label={statusLabel}>
          <StatusIcon className={isRunning ? 'is-spinning' : ''} size={15} strokeWidth={2} />
          <span>{visibleStatusLabel}</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={stepsId}
            className="hermes-tool-card__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <ol className="hermes-tool-card__steps">
              {entries.map((entry, index) => (
                <ToolActivityStep
                  key={entry.id}
                  entry={entry}
                  index={index}
                  isLast={index === entries.length - 1}
                />
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
