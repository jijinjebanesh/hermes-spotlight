import {
  formatToolCompleteEvt,
  formatToolStartEvt,
  render_inline_diff,
  type ToolCompleteEvent,
  type ToolStartEvent,
} from '../tool-parser';

export type HermesJsonEvent =
  | { type: 'segment'; segment: StreamSegmentEvent }
  | { type: 'session'; sessionId: string }
  | { type: 'status'; tokens: number; durationS: number }
  | { type: 'error'; message: string };

export type StreamSegmentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; toolId: string; name: string; args: Record<string, any>; display: string }
  | { type: 'tool_complete'; toolId: string; name: string; args: Record<string, any>; result: string; durationS?: number; inlineDiff?: string; diffLines?: ReturnType<typeof render_inline_diff>; error?: string; display: string }
  | { type: 'clarify'; question: string; choices?: string[]; multiSelect?: boolean };

type OpenTool = { name: string; args: Record<string, any>; event: ToolStartEvent };

/** Parses Hermes' documented newline-delimited `--format stream-json` protocol. */
export class HermesJsonlParser {
  private buffer = '';
  private sawText = false;
  private fallbackToolId = 0;
  private openTools = new Map<string, OpenTool>();

  push(chunk: string): HermesJsonEvent[] {
    this.buffer += chunk;
    const events: HermesJsonEvent[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.parseLine(line, events);
      newline = this.buffer.indexOf('\n');
    }
    return events;
  }

  finish(): HermesJsonEvent[] {
    const events: HermesJsonEvent[] = [];
    if (this.buffer.trim()) this.parseLine(this.buffer, events);
    this.buffer = '';
    for (const [toolId, tool] of this.openTools) {
      const completion: ToolCompleteEvent = {
        type: 'tool_complete',
        toolId,
        name: tool.name,
        args: tool.args,
        result: '',
        error: 'Stream ended before the tool completed',
      };
      events.push({ type: 'segment', segment: this.toToolComplete(completion) });
    }
    this.openTools.clear();
    return events;
  }

  private parseLine(line: string, events: HermesJsonEvent[]) {
    if (!line.trim()) return;
    // The gateway-backed CLI writes this session identifier to stderr instead
    // of including it in the stream-json init event. Keep the overlay's resume
    // mapping even when a clarify tool handoff stops the stream before result.
    const announcedSession = /^Session:\s+(local-[a-z0-9-]+)\s*$/i.exec(line.trim());
    if (announcedSession) {
      events.push({ type: 'session', sessionId: announcedSession[1] });
      return;
    }
    let data: any;
    try {
      data = JSON.parse(line);
    } catch {
      // Ignore malformed and non-protocol lines so diagnostics never leak into the answer.
      return;
    }
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

    if (data.type === 'system' && data.subtype === 'init' && typeof data.session_id === 'string' && data.session_id) {
      events.push({ type: 'session', sessionId: data.session_id });
      return;
    }

    if (data.type === 'text' && typeof data.text === 'string') {
      this.sawText = true;
      events.push({ type: 'segment', segment: { type: 'text', content: data.text } });
      return;
    }

    if (data.type === 'tool_use' && typeof data.name === 'string') {
      const args = data.input && typeof data.input === 'object' && !Array.isArray(data.input) ? data.input : {};
      if (data.name === 'clarify') {
        const questions = Array.isArray(args.questions) ? args.questions : [];
        for (const item of questions) {
          if (typeof item?.question !== 'string' || !item.question.trim()) continue;
          events.push({
            type: 'segment',
            segment: {
              type: 'clarify',
              question: item.question,
              choices: Array.isArray(item.choices) ? item.choices.filter((choice: unknown) => typeof choice === 'string') : undefined,
              multiSelect: Boolean(item.multi_select),
            },
          });
        }
        return;
      }

      const toolId = typeof data.tool_call_id === 'string' && data.tool_call_id
        ? data.tool_call_id
        : `${data.name}-${++this.fallbackToolId}`;
      const event: ToolStartEvent = { type: 'tool_start', toolId, name: data.name, args };
      this.openTools.set(toolId, { name: data.name, args, event });
      events.push({
        type: 'segment',
        segment: { ...event, display: formatToolStartEvt(event) },
      });
      return;
    }

    if (data.type === 'tool_result' && typeof data.name === 'string') {
      const toolId = typeof data.tool_call_id === 'string' ? data.tool_call_id : '';
      const exactOpen = toolId ? this.openTools.get(toolId) : undefined;
      const namedOpen = exactOpen
        ? undefined
        : [...this.openTools.entries()].find(([, tool]) => tool.name === data.name);
      const open = exactOpen ?? namedOpen?.[1];
      const resolvedId = exactOpen
        ? toolId
        : namedOpen?.[0] || toolId || `${data.name}-${++this.fallbackToolId}`;
      if (open) this.openTools.delete(exactOpen ? toolId : namedOpen![0]);
      const output = data.output == null
        ? ''
        : typeof data.output === 'string'
          ? data.output
          : JSON.stringify(data.output);
      const diff = /^(?:diff --git |--- .+\n\+\+\+ )/m.test(output) ? output : undefined;
      const completion: ToolCompleteEvent = {
        type: 'tool_complete',
        toolId: resolvedId,
        name: data.name,
        args: open?.args ?? {},
        result: output,
        duration_s: typeof data.duration_ms === 'number' ? data.duration_ms / 1000 : undefined,
        error: data.is_error ? output || 'Tool failed' : undefined,
        inline_diff: diff,
        diffLines: diff ? render_inline_diff(diff) : undefined,
      };
      events.push({ type: 'segment', segment: this.toToolComplete(completion) });
      return;
    }

    if (data.type === 'result') {
      if (!this.sawText && typeof data.text === 'string' && data.text) {
        this.sawText = true;
        events.push({ type: 'segment', segment: { type: 'text', content: data.text } });
      }
      if (typeof data.error === 'string' && data.error.trim()) {
        events.push({ type: 'error', message: data.error.trim() });
      }
      events.push({
        type: 'status',
        tokens: Number(data.tokens?.total) || 0,
        durationS: Math.max(0, Math.ceil((Number(data.duration_ms) || 0) / 1000)),
      });
      if (typeof data.session_id === 'string' && data.session_id) {
        events.push({ type: 'session', sessionId: data.session_id });
      }
    }
  }

  private toToolComplete(event: ToolCompleteEvent): Extract<StreamSegmentEvent, { type: 'tool_complete' }> {
    return {
      type: 'tool_complete',
      toolId: event.toolId,
      name: event.name,
      args: event.args,
      result: event.result,
      durationS: event.duration_s,
      inlineDiff: event.inline_diff,
      diffLines: event.diffLines,
      error: event.error,
      display: formatToolCompleteEvt(event),
    };
  }
}
