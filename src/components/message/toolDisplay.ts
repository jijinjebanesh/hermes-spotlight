// ── TUI-style tool display formatting for Hermes Overlay renderer ──
// Uses tool-parser.ts formatters to produce display lines matching
// Hermes TUI output (agent/display.py _CUTE_LINES style).

import {
  ToolStartEvent,
  ToolCompleteEvent,
  render_inline_diff,
  DiffLine,
  TOOL_EMOJI,
  tool_complete_line,
  tool_start_line,
  build_tool_preview,
  ToolStartDisplay,
  ToolCompleteDisplay,
} from '../../tool-parser';

export type ToolStartSegment = ToolStartEvent;
export type ToolCompleteSegment = ToolCompleteEvent;
export type { ToolStartDisplay, ToolCompleteDisplay, DiffLine };

// ── Display line for tool start (preparing phase) ──

export function formatToolStartForDisplay(segment: ToolStartEvent): ToolStartDisplay {
  const emoji = segment.emoji || TOOL_EMOJI[segment.name] || '⚡';
  const preview = build_tool_preview(segment.name, segment.args, 120);
  const detail = preview || segment.name;
  return {
    emoji,
    verb: 'preparing',
    detail,
    full: `${emoji} preparing ${detail}`,
  };
}

// ── Display line for tool complete ──

export function formatToolCompleteForDisplay(segment: ToolCompleteEvent): ToolCompleteDisplay {
  const emoji = (segment as any).emoji || TOOL_EMOJI[segment.name] || '⚡';
  const durVal = segment.duration_s ?? segment.durationS;
  const full = tool_complete_line(
    segment.name,
    segment.args,
    segment.result,
    durVal,
    120,
  );

  // Strip leading tree character and emoji from full line
  let cleanFull = full.replace(/^[│┊]\s*/, '');
  cleanFull = cleanFull.replace(/^(\p{Extended_Pictographic}|\S+)\s+/u, (m, p1) => {
    return /\p{Extended_Pictographic}/u.test(p1) ? '' : m;
  });

  const parts = cleanFull.split(/\s{2,}/);
  let verbPart = (parts[0] || segment.name).trim();
  verbPart = verbPart.replace(/^\p{Extended_Pictographic}\s*/u, '').trim() || segment.name;
  const detailPart = parts.slice(1).join(' ').trim() || '';

  // Extract duration if present
  const durMatch = detailPart.match(/(\d+\.?\d*)s$/);
  const duration = durMatch ? parseFloat(durMatch[1]) : durVal;

  // Extract error if present
  const errorMatch = detailPart.match(/\[([^\]]+)\]/);
  const error = errorMatch ? errorMatch[1] : segment.error;

  // Clean detail to remove duration and error suffix
  let detail = detailPart;
  if (durMatch) {
    detail = detail.replace(/\s+\d+\.?\d*s$/, '').trim();
  }
  if (errorMatch) {
    detail = detail.replace(/\s+\[[^\]]+\]$/, '').trim();
  }

  return {
    emoji,
    verb: verbPart,
    detail,
    full,
    duration,
    durationS: duration,
    error,
  };
}

// ── Diff renderer ──

export function renderDiffLines(diffText: string): DiffLine[] {
  return render_inline_diff(diffText);
}

