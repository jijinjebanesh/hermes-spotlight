// ── Hermes TUI-style tool parser & formatter for Hermes Overlay ──
// Replaces the old line-by-line box-parsing in hermes-cli.ts with structured
// tool lifecycle events (tool_start, tool_complete) mirroring agent/display.py.

// ── Tool emoji map (from display.py get_tool_emoji / _CUTE_LINES) ──
export const TOOL_EMOJI: Record<string, string> = {
  web_search: '🔍',
  web_extract: '📄',
  terminal: '💻',
  process_manage: '⚙️',
  read_file: '📖',
  write_file: '✍️',
  patch: '🔧',
  search_files: '🔎',
  browser_navigate: '🌐',
  browser_snapshot: '📸',
  browser_click: '👆',
  browser_type: '⌨️',
  browser_scroll: '↓',
  browser_back: '◀️',
  browser_press: '⌨️',
  browser_get_images: '🖼️',
  browser_vision: '👁️',
  todo_list: '📋',
  session_search: '🔍',
  memory: '🧠',
  skills_list: '📚',
  skill_view: '📚',
  image_generate: '🎨',
  text_to_speech: '🔊',
  vision_analyze: '👁️',
  send_message: '📨',
  cronjob_manage: '⏰',
  execute_code: '🐍',
  browser_exec: '🌐',
  delegate_task: '🔀',
  clarify: '❓',
  skill_manage: '📚',
};

// ── Friendly tool verbs (from display.py _TOOL_VERBS) ──
const TOOL_VERBS: Record<string, string> = {
  web_search: 'Searching the web',
  web_extract: 'Reading',
  browser_navigate: 'Browsing',
  browser_click: 'Clicking',
  browser_type: 'Typing',
  read_file: 'Reading',
  write_file: 'Writing',
  patch: 'Editing',
  search_files: 'Searching files',
  terminal: 'Running',
  execute_code: 'Running code',
  image_generate: 'Generating image',
  text_to_speech: 'Generating speech',
  vision_analyze: 'Looking at the image',
  session_search: 'Searching past sessions',
  skill_view: 'Reading skill',
  skills_list: 'Listing skills',
  skill_manage: 'Updating skill',
  delegate_task: 'Delegating',
  cronjob_manage: 'Scheduling',
  clarify: 'Asking',
  memory: 'Updating memory',
  todo_list: 'Updating tasks',
};

const TOOL_VERBS_NO_PREVIEW = new Set(['skills_list', 'session_search']);
const TOOL_VERBS_FOR_CONNECTOR = new Set(['web_search', 'search_files']);

// ── Primary arg keys (from display.py _PRIMARY_ARGS) ──
const PRIMARY_ARGS: Record<string, string> = {
  terminal: 'command',
  web_search: 'query',
  web_extract: 'urls',
  read_file: 'path',
  write_file: 'path',
  patch: 'path',
  search_files: 'pattern',
  browser_navigate: 'url',
  browser_click: 'ref',
  browser_type: 'text',
  image_generate: 'prompt',
  text_to_speech: 'text',
  vision_analyze: 'question',
  skill_view: 'name',
  skills_list: 'category',
  cronjob_manage: 'action',
  execute_code: 'code',
  browser_exec: 'code',
  delegate_task: 'goal',
  clarify: 'question',
  skill_manage: 'name',
};

const FALLBACK_PREVIEW_KEYS = ['query', 'text', 'command', 'path', 'name', 'prompt', 'code', 'goal'];

// ── Helpers ──

function _oneline(text: string): string {
  return text.split(/\s+/).join(' ');
}

function _tail_trunc(text: string, limit: number | null | undefined): string {
  if (limit == null || limit <= 0 || text.length <= limit) return text;
  if (limit <= 3) return '.'.repeat(limit);
  return text.slice(0, limit - 3) + '...';
}

function _cute_path(p: string, limit: number): string {
  if (limit == null || limit <= 0 || p.length <= limit) return p;
  if (limit <= 3) return '.'.repeat(limit);
  return '...' + p.slice(-(limit - 3));
}

function _cute_trunc(s: string, limit: number): string {
  return _tail_trunc(String(s), limit);
}

function _domain(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

function _display_url(value: any): string {
  if (typeof value !== 'object' || value === null) return '';
  return (value.url ?? value.href ?? '').trim();
}

function _trim_error(msg: string): string {
  msg = msg.trim();
  if (msg.includes('File not found:')) {
    const tail = msg.split('File not found:')[1]?.trim() || '';
    if (tail.includes('/')) {
      return `File not found: ${tail.split('/').pop()}`;
    }
  }
  return _tail_trunc(msg, 48);
}

function _read_file_line_label(args: any): string {
  const offset = args?.offset;
  const limit = args?.limit;
  if (typeof offset !== 'number' || offset <= 0) return '';
  if (typeof limit === 'number' && limit > 1) return `L${offset}-${offset + limit - 1}`;
  return `L${offset}`;
}

function _browser_exec_step_label(args: any): string | null {
  const code = String(args?.code ?? '').trim();
  const first = code.split('\n')[0].trim();
  if (first.startsWith('#')) {
    const label = first.slice(1).trim();
    return label || null;
  }
  return null;
}

function _delegate_action_preview(args: any): string | null {
  const action = String(args?.action ?? '').trim().toLowerCase();
  if (['list', 'steer', 'stop'].includes(action)) {
    return `${action} ${String(args?.subagent_id ?? '').trim()}`;
  }
  return null;
}

function _clip(text: string, n: number): string {
  return `${text.slice(0, n)}${text.length > n ? '...' : ''}`;
}

// ── Shell command summarisation (from display.py summarize_shell_command) ──
const _SHELL_SILENT_HEADS = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'source', '.', 'true', 'false', ':']);
const _SHELL_PIPE_TAIL_HEADS = new Set(['head', 'tail', 'wc', 'sort', 'uniq']);

function _shell_basename(head: string): string {
  return head.split('/').pop() ?? '';
}

function _scan_quoted(text: string): Array<{ i: number; ch: string; quoted: boolean }> {
  const result: Array<{ i: number; ch: string; quoted: boolean }> = [];
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      result.push({ i, ch, quoted: true });
      if (ch === quote && (i === 0 || text[i - 1] !== '\\')) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      result.push({ i, ch, quoted: true });
    } else {
      result.push({ i, ch, quoted: false });
    }
  }
  return result;
}

function _split_shell_words(segment: string): string[] {
  const parts: string[][] = [[]];
  for (const { ch, quoted } of _scan_quoted(segment)) {
    if (!quoted && ch.trim() === '') parts.push([]);
    else parts[parts.length - 1].push(ch);
  }
  return parts.filter(p => p.length > 0).map(p => p.join(''));
}

function _strip_shell_pipe_tail(segment: string): string {
  const words = _split_shell_words(segment);
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '|' && _SHELL_PIPE_TAIL_HEADS.has(_shell_basename(words[i + 1] ?? ''))) {
      return words.slice(0, i).join(' ').trim();
    }
  }
  return words.join(' ').trim();
}

function _split_shell_compound(command: string): string[] {
  const raw: string[][] = [[]];
  let skip = false;
  const quoted = _scan_quoted(command);
  for (const { i, ch, quoted: q } of quoted) {
    if (skip) { skip = false; continue; }
    if (!q && command.startsWith('&&', i)) { raw.push([]); skip = true; continue; }
    if (!q && command.startsWith('||', i)) { raw.push([]); skip = true; continue; }
    if (!q && ch === ';') raw.push([]);
  }
  return raw.map(buf => _strip_shell_pipe_tail(buf.join('').trim())).filter(s => s.length > 0);
}

function _shell_head_word(segment: string): string {
  const words = _split_shell_words(segment);
  let i = 0;
  while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) i++;
  return _shell_basename(words[i] ?? '');
}

function _clean_shell_segment(segment: string): string {
  const words = _split_shell_words(segment);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (/^\d*(?:>>?|<)$/.test(word)) i += 2;
    else if (/^\d*(?:>&|<&)\d+$/.test(word)) i += 1;
    else { out.push(word); i++; }
  }
  return out.join(' ').trim();
}

function _is_shell_boundary_echo(segment: string): boolean {
  const words = _split_shell_words(segment);
  if (_shell_basename(words[0] ?? '') !== 'echo') return false;
  return /\s-{2,}|(_exit=|(?:^|\s|=)\$[?{]|PIPESTATUS)/.test(words.slice(1).join(' '));
}

export function summarize_shell_command(command: string): string {
  const original = _oneline(command);
  if (!original) return '';
  const segments = _split_shell_compound(original);
  if (segments.length <= 1) return _clean_shell_segment(segments[0] ?? original) || original;
  const core: string[] = [];
  for (const segment of segments) {
    const cleaned = _clean_shell_segment(segment);
    if (cleaned && !_SHELL_SILENT_HEADS.has(_shell_head_word(cleaned)) && !_is_shell_boundary_echo(cleaned)) {
      core.push(cleaned);
    }
  }
  if (!core.length) return original;
  const count = core.length - 1;
  return count === 0 ? core[0] : `${core[0]} + ${count} ${count === 1 ? 'command' : 'commands'}`;
}

// ── Preview builders (from display.py build_tool_preview) ──

function _preview_browser_exec(args: any, max_len: number): string | null {
  const label = _browser_exec_step_label(args);
  if (label) return _tail_trunc(label, max_len);
  return _tail_trunc(_oneline(String(args?.code ?? '')), max_len) || null;
}

function _preview_delegate_task(args: any, max_len: number): string | null {
  const action_preview = _delegate_action_preview(args);
  if (action_preview) return _tail_trunc(action_preview, max_len);
  const tasks = args?.tasks;
  if (Array.isArray(tasks)) {
    const goals = tasks.map((t: any) => t?.goal ? _tail_trunc(_oneline(String(t.goal)), 40) : '?');
    const preview = goals.length ? `${goals.length} tasks: ${goals.join(' | ')}` : `${tasks.length} parallel tasks`;
    return _tail_trunc(preview, max_len);
  }
  const goal = args?.goal;
  return goal == null ? null : _tail_trunc(_oneline(String(goal)), max_len);
}

function _preview_process_manage(args: any, _max_len: number): string | null {
  const action = args?.action;
  const sid = String(args?.session_id ?? '').slice(0, 12);
  const parts = [
    String(action ?? ''),
    sid || '',
    args?.data ? `"${_oneline(String(args.data).slice(0, 20))}"` : '',
    args?.timeout && action === 'wait' ? `${args.timeout}s` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function _preview_todo_list(args: any, _max_len: number): string {
  const todos_arg = args?.todos;
  const verb = args?.merge ? 'updating' : 'planning';
  return todos_arg == null ? 'reading task list' : `${verb} ${todos_arg.length} task(s)`;
}

function _preview_shell(key: string) {
  return function (args: any, max_len: number): string | null {
    const command = args?.[key];
    if (command == null) return null;
    return _tail_trunc(summarize_shell_command(String(command)), max_len) || null;
  };
}

function _preview_read_file(args: any, max_len: number): string | null {
  const path = args?.path ?? args?.file ?? args?.filepath;
  if (path == null) return null;
  const name = String(path).split('/').pop() ?? String(path);
  const label = `${name} ${_read_file_line_label(args)}`.trim();
  return _tail_trunc(label, max_len) || null;
}

function _preview_memory(args: any, _max_len: number): string {
  const action = args?.action ?? '?';
  const target = args?.target ?? '';
  if (action === 'add') {
    return `+${target}: "${_clip(_oneline(String(args.content ?? '')), 25)}"`;
  }
  if (action === 'replace' || action === 'remove') {
    const old = _oneline(String(args.old_text ?? '')) || '<missing old_text>';
    return `${action === 'replace' ? '~' : '-'}${target}: "${old.slice(0, 20)}"`;
  }
  return action;
}

function _preview_send_message(args: any, _max_len: number): string {
  return `to ${args?.target ?? '?'}: "${_tail_trunc(_oneline(String(args.message ?? '')), 20)}"`;
}

function _preview_skill_view(args: any, max_len: number): string | null {
  const name = _oneline(String(args?.name ?? ''));
  const file_path = args?.file_path;
  const label = file_path
    ? (name ? `${name} → ${file_path}` : String(file_path))
    : name;
  return _tail_trunc(label, max_len) || null;
}

const _PREVIEW_BUILDERS: Record<string, Function> = {
  browser_exec: _preview_browser_exec,
  delegate_task: _preview_delegate_task,
  process_manage: _preview_process_manage,
  todo_list: _preview_todo_list,
  terminal: _preview_shell('command'),
  execute_code: _preview_shell('code'),
  read_file: _preview_read_file,
  memory: _preview_memory,
  send_message: _preview_send_message,
  skill_view: _preview_skill_view,
  session_search: (_args: any, _m: number) => `recall: "${_clip(_oneline(String(_args.query ?? '')), 25)}"`,
};

export function build_tool_preview(tool_name: string, args: Record<string, any> | null | undefined, max_len?: number | null): string | null {
  if (!args) return null;
  const ml = max_len ?? null;
  const builder = _PREVIEW_BUILDERS[tool_name];
  if (builder) return builder(args, ml ?? 9999);

  const key = PRIMARY_ARGS[tool_name] ?? FALLBACK_PREVIEW_KEYS.find(k => k in args);
  if (!key || !(key in args)) return null;
  const value = args[key];
  const preview = _oneline(Array.isArray(value) ? (value[0] ?? '') : value);
  return preview ? _tail_trunc(preview, ml ?? 9999) : null;
}

// ── Friendly tool label (from display.py build_tool_label) ──

export function build_tool_label(tool_name: string, args: Record<string, any> | null | undefined, max_len?: number | null): string | null {
  const verb = TOOL_VERBS[tool_name];
  if (!verb) return build_tool_preview(tool_name, args, max_len) ?? null;
  if (TOOL_VERBS_NO_PREVIEW.has(tool_name)) return verb;
  const preview = build_tool_preview(tool_name, args, max_len);
  const connector = TOOL_VERBS_FOR_CONNECTOR.has(tool_name) ? ' for ' : ' ';
  return preview ? `${verb}${connector}${preview}` : verb;
}

// ── Per-tool completion-line renderers (from display.py _CUTE_LINES) ──
// Each: (args, result) => "┊ {emoji} {verb:9} {detail}"

type CuteLineRenderer = (args: any, result: any) => string;

const _CUTE_LINES: Record<string, CuteLineRenderer> = {
  web_search: (a) => `🔍 search    ${_cute_trunc(String(a.query ?? ''), 80)}`,
  web_extract: (a) => {
    const urls = a?.urls ?? [];
    const url = Array.isArray(urls) ? (urls[0] ?? '') : urls;
    const displayUrl = typeof url === 'string' ? _display_url(url) : '';
    if (!displayUrl) return '📄 fetch     pages';
    const extra = Array.isArray(urls) && urls.length > 1 ? ` +${urls.length - 1}` : '';
    return `📄 fetch     ${_cute_trunc(_domain(displayUrl), 80)}${extra}`;
  },
  terminal: (a) => `💻 $         ${_cute_trunc(build_tool_preview('terminal', a) ?? String(a.command ?? ''), 80)}`,
  process_manage: (a) => {
    const action = a?.action ?? '?';
    const sid = String(a?.session_id ?? '').slice(0, 12);
    return action === 'list' ? '⚙️  proc      ls processes' : `⚙️  proc      ${action} ${sid}`;
  },
  read_file: (a) => `📖 read      ${_cute_trunc(build_tool_preview('read_file', a) ?? String(a.path ?? ''), 80)}`,
  write_file: (a) => `✍️  write     ${_cute_path(String(a.path ?? ''), 80)}`,
  patch: (a) => `🔧 patch     ${_cute_path(String(a.path ?? ''), 80)}`,
  search_files: (a) => {
    const target = a?.target ?? 'content';
    const verb = target === 'files' ? 'find' : 'grep';
    return `🔎 ${verb.padEnd(9)} ${_cute_trunc(String(a.pattern ?? ''), 80)}`;
  },
  browser_navigate: (a) => `🌐 navigate  ${_cute_trunc(_domain(String(a.url ?? '')), 80)}`,
  browser_snapshot: (a) => `📸 snapshot  ${a?.full ? 'full' : 'compact'}`,
  browser_click: (a) => `👆 click     ${a?.ref ?? '?'}`,
  browser_type: (a) => `⌨️  type      "${_cute_trunc(String(a.text ?? ''), 80)}"`,
  browser_scroll: (a) => `↓  scroll    ${a?.direction ?? 'down'}`,
  browser_back: () => `◀️  back    `,
  browser_press: (a) => `⌨️  press     ${a?.key ?? '?'}`,
  browser_get_images: () => `🖼️  images    extracting`,
  browser_vision: () => `👁️  vision    analyzing page`,
  todo_list: (a, r) => {
    const todos_arg = a?.todos;
    const total = r?.summary?.total ?? 0;
    const done = r?.summary?.completed ?? 0;
    let detail: string;
    if (todos_arg == null) {
      detail = total > 0 ? `${done}/${total} task(s)` : 'reading tasks';
    } else if (a?.merge) {
      detail = total > 0 && done > 0 ? `update ${done}/${total} ✓` : `update ${todos_arg.length} task(s)`;
    } else {
      detail = total > 0 && done > 0 ? `${done}/${total} task(s)` : `${todos_arg.length} task(s)`;
    }
    return `📋 plan      ${detail}`;
  },
  session_search: (a) => `🔍 recall    "${_cute_trunc(String(a.query ?? ''), 80)}"`,
  memory: (a) => {
    const action = a?.action ?? '?';
    const target = a?.target ?? '';
    if (action === 'add') return `🧠 memory    +${target}: "${_cute_trunc(String(a.content ?? ''), 80)}"`;
    if (action === 'replace' || action === 'remove') {
      const old = String(a.old_text ?? '') || '<missing old_text>';
      return `🧠 memory    ${action === 'replace' ? '~' : '-'}${target}: "${_cute_trunc(old, 80)}"`;
    }
    return `🧠 memory    ${action}`;
  },
  skills_list: (a) => `📚 skills    list ${a?.category ?? 'all'}`,
  skill_view: (a) => {
    const label = a?.name ?? '';
    const file_path = a?.file_path;
    const display = file_path ? (label ? `${label} → ${file_path}` : String(file_path)) : label;
    return `📚 skill     ${_cute_trunc(display, 80)}`;
  },
  image_generate: (a) => `🎨 create    ${_cute_trunc(String(a.prompt ?? ''), 80)}`,
  text_to_speech: (a) => `🔊 speak     ${_cute_trunc(String(a.text ?? ''), 80)}`,
  vision_analyze: (a) => `👁️  vision    ${_cute_trunc(String(a.question ?? ''), 80)}`,
  send_message: (a) => `📨 send      ${a?.target ?? '?'}: "${_cute_trunc(String(a.message ?? ''), 80)}"`,
  cronjob_manage: (a) => {
    const action = a?.action ?? '?';
    if (action === 'create') {
      const skills = a?.skills ?? (a?.skill ? [a.skill] : []);
      const label = a?.name ?? (skills[0] ?? a?.prompt ?? 'task');
      return `⏰ cron      create ${_cute_trunc(String(label), 80)}`;
    }
    return action === 'list' ? '⏰ cron      listing' : `⏰ cron      ${action} ${a?.job_id ?? ''}`;
  },
  execute_code: (a) => {
    const code = String(a?.code ?? '').trim();
    return `🐍 exec      ${_cute_trunc(code.split('\n')[0] ?? '', 80)}`;
  },
  browser_exec: (a) => {
    const label = _browser_exec_step_label(a);
    const code = String(a?.code ?? '');
    return `🌐 browser   ${label ? _cute_trunc(label, 80) : _cute_trunc(_oneline(code), 80)}`;
  },
  delegate_task: (a) => {
    const action_preview = _delegate_action_preview(a);
    const tasks = a?.tasks;
    if (action_preview) return `🔀 delegate  ${_cute_trunc(action_preview, 80)}`;
    if (Array.isArray(tasks)) {
      const goals = tasks.map((t: any) => t?.goal ? _tail_trunc(_oneline(String(t.goal)), 30) : '?');
      return `🔀 delegate  ${goals.length || tasks.length}x: ${_cute_trunc(goals.length ? goals.join(' | ') : 'parallel', 80)}`;
    }
    return `🔀 delegate  ${_cute_trunc(String(a?.goal ?? ''), 80)}`;
  },
  clarify: (a) => `❓ clarify   ${_cute_trunc(build_tool_preview('clarify', a) ?? String(a.question ?? ''), 80)}`,
  skill_manage: (a) => `📚 skill-mgr ${_cute_trunc(String(a.name ?? ''), 80)}`,
};

// ── Tool start line ──

export function tool_start_line(tool_name: string, args: Record<string, any> | null | undefined, preview_max_len: number = 80): string {
  const emoji = TOOL_EMOJI[tool_name] ?? '⚡';
  const preview = build_tool_preview(tool_name, args, preview_max_len);
  const label = preview ? `${emoji} preparing ${tool_name} ${preview}` : `${emoji} preparing ${tool_name}`;
  return label.trim();
}

// ── Tool complete line ──

function _detect_tool_failure(tool_name: string, result: any): { isFailure: boolean; suffix: string } {
  if (result == null) return { isFailure: false, suffix: '' };
  const data = typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return null; } })() : result;

  if (tool_name === 'terminal') {
    const exit_code = data?.exit_code;
    if (exit_code == null || exit_code === 0) return { isFailure: false, suffix: '' };
    const err_msg = data?.error;
    return {
      isFailure: true,
      suffix: err_msg ? ` [${_trim_error(String(err_msg))}]` : ` [exit ${exit_code}]`,
    };
  }

  if (data && typeof data === 'object') {
    const failed = data.success === false;
    if (tool_name === 'memory' && failed && String(data.error || '').includes('exceed the limit')) {
      return { isFailure: true, suffix: ' [full]' };
    }
    const err = data.error || data.message;
    if (err && (failed || 'error' in data)) {
      return { isFailure: true, suffix: ` [${_trim_error(String(err))}]` };
    }
  }

  if (typeof result === 'string') {
    const lower = result.slice(0, 500).toLowerCase();
    if (lower.includes('"error"') || lower.includes('"failed"') || result.startsWith('Error')) {
      return { isFailure: true, suffix: ' [error]' };
    }
  }

  return { isFailure: false, suffix: '' };
}

export function tool_complete_line(
  tool_name: string,
  args: Record<string, any> | null | undefined,
  result: any,
  duration_s: number | null | undefined,
  preview_max_len: number = 80,
): string {
  const { isFailure, suffix } = _detect_tool_failure(tool_name, result);
  const emoji = TOOL_EMOJI[tool_name] ?? '⚡';
  const renderer = _CUTE_LINES[tool_name];

  let body: string;
  if (renderer) {
    body = renderer(args, result);
  } else {
    const preview = build_tool_preview(tool_name, args, preview_max_len);
    body = `${emoji} ${tool_name.slice(0, 9).padEnd(9)} ${preview ?? ''}`.trim();
  }

  const dur = duration_s != null ? `  ${duration_s.toFixed(1)}s` : '';
  return `${body}${dur}${suffix}`.trim();
}

/** Normalize terminal stdout from current and legacy result envelopes. */
export function terminal_output_text(result: unknown): string | null {
  let output = result;

  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;

    // Older persisted calls wrapped stdout in a JSON object.
    if (trimmed.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && 'output' in parsed) {
          output = (parsed as { output?: unknown }).output;
        }
      } catch {
        // Plain text that happens to start with a brace remains valid stdout.
      }
    }
  } else if (output && typeof output === 'object' && 'output' in output) {
    output = (output as { output?: unknown }).output;
  }

  if (typeof output !== 'string') return null;
  const normalized = output.replace(/^\r?\n|\r?\n$/g, '');
  const trimmed = normalized.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;
  return normalized;
}

// ── Inline diff rendering (from display.py _render_inline_unified_diff) ──

export interface DiffLine {
  type: 'header' | 'minus' | 'plus' | 'context' | 'hunk' | 'plain';
  text: string;
  filename?: string;
}

export function render_inline_diff(diff_text: string): DiffLine[] {
  if (!diff_text) return [];
  const lines: DiffLine[] = [];
  let from_file = '', to_file = '';

  for (const raw of diff_text.split('\n')) {
    if (raw.startsWith('--- ')) {
      from_file = raw.slice(4).trim();
      continue;
    }
    if (raw.startsWith('+++ ')) {
      to_file = raw.slice(4).trim();
      if (from_file || to_file) {
        lines.push({ type: 'header', text: `${from_file || 'a/?'} → ${to_file || 'b/?'}`, filename: to_file || from_file });
      }
      continue;
    }
    let type: DiffLine['type'] = 'plain';
    if (raw.startsWith('@@')) type = 'hunk';
    else if (raw.startsWith('-') && !raw.startsWith('---')) type = 'minus';
    else if (raw.startsWith('+') && !raw.startsWith('+++')) type = 'plus';
    else if (raw.startsWith(' ')) type = 'context';
    lines.push({ type, text: raw });
  }
  return lines;
}

// ── Structured event types (mirror TUI's tool.start / tool.complete) ──

export interface ToolStartEvent {
  type: 'tool_start';
  toolId: string;
  name: string;
  args: Record<string, any>;
  emoji?: string;
}

export interface ToolCompleteEvent {
  type: 'tool_complete';
  toolId: string;
  name: string;
  args: Record<string, any>;
  result: any;
  duration_s?: number;
  durationS?: number;
  summary?: string;
  inline_diff?: string;
  inlineDiff?: string;
  diffLines?: DiffLine[];
  error?: string;
  result_text?: string;
}

export interface ClarifyEvent {
  type: 'clarify';
  question: string;
  choices?: string[];
  multiSelect?: boolean;
  answer?: string;
}

export interface FileNoticeEvent {
  type: 'file_notice';
  filename: string;
}

export interface DiffEvent {
  type: 'diff';
  content: string;
  diffLines?: DiffLine[];
}

export interface ThinkingDeltaEvent {
  type: 'thinking_delta';
  text: string;
}

export interface ReasoningDeltaEvent {
  type: 'reasoning_delta';
  text: string;
  verbose?: boolean;
}

export type HermesStreamEvent =
  | ToolStartEvent
  | ToolCompleteEvent
  | ClarifyEvent
  | FileNoticeEvent
  | DiffEvent
  | ThinkingDeltaEvent
  | ReasoningDeltaEvent;

// ── Display line interfaces (for UI consumption) ──

export interface ToolStartDisplay {
  emoji: string;
  verb: string;
  detail: string;
  full: string;
}

export interface ToolCompleteDisplay {
  emoji: string;
  verb: string;
  detail: string;
  full: string;
  duration?: number;
  durationS?: number;
  error?: string;
}

// ── Parser state ──

export interface ParseState {
  toolStartStack: ToolStartEvent[];
  diffBuffer: string;
  inDiff: boolean;
}

// ── Parser: convert raw Hermes CLI stdout into structured events ──

export function parseHermesOutput(output: string, state: ParseState): HermesStreamEvent[] {
  const events: HermesStreamEvent[] = [];
  const lines = output.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ── Detected file: "📄 Detected file: SD.pdf" ──
    const fileDetectedMatch = trimmed.match(/^(?:📄\s*)?Detected file:\s*(.+)$/);
    if (fileDetectedMatch) {
      events.push({
        type: 'file_notice',
        filename: fileDetectedMatch[1].trim(),
      });
      continue;
    }

    // ── Structured Clarify: "CLARIFY: {"question": "...", "choices": [...], "multi_select": false}" ──
    const clarifyJsonMatch = trimmed.match(/CLARIFY:\s*(\{.*\})/i);
    if (clarifyJsonMatch) {
      try {
        const payload = JSON.parse(clarifyJsonMatch[1]);
        events.push({
          type: 'clarify',
          question: payload.question || '',
          choices: Array.isArray(payload.choices) ? payload.choices : [],
          multiSelect: Boolean(payload.multi_select),
          answer: payload.answer || undefined,
        });
        continue;
      } catch {
        // Fall through if not valid JSON
      }
    }

    // ── Clarify question: "? Clarify: Which resume profile... → Answer" ──
    const clarifyMatch = trimmed.match(/^\?\s*Clarify:\s*(.+?)(?:\s*→\s*(.*))?$/i);
    if (clarifyMatch) {
      events.push({
        type: 'clarify',
        question: clarifyMatch[1].trim(),
        answer: clarifyMatch[2] ? clarifyMatch[2].trim() : undefined,
      });
      continue;
    }

    // ── Tool start: "┊ ✍️ preparing write_file…" or "┊ preparing read_file" ──
    const toolStartMatch = trimmed.match(/^[│┊]\s*(?:(\p{Extended_Pictographic})\s+)?(?:preparing|prepares?)\s+(\S+)(.*)$/iu);
    if (toolStartMatch) {
      const rawEmoji = toolStartMatch[1];
      const rawName = toolStartMatch[2];
      const rest = toolStartMatch[3].trim();
      const name = rawName.replace(/(?:…|\.{3})$/, '');
      const emoji = rawEmoji || TOOL_EMOJI[name] || '⚡';
      const args = extractArgsFromPreview(name, rest);
      const evt: ToolStartEvent = {
        type: 'tool_start',
        toolId: `cli-start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        args,
        emoji,
      };
      state.toolStartStack.push(evt);
      events.push(evt);
      continue;
    }

    // ── Diff start line: "┊ review diff" ──
    if (trimmed.includes('review diff')) {
      state.inDiff = true;
      state.diffBuffer = '';
      continue;
    }

    // ── While inside diff block ──
    if (state.inDiff) {
      const isDiffLine =
        trimmed.startsWith('--- ') ||
        trimmed.startsWith('+++ ') ||
        trimmed.startsWith('@@') ||
        trimmed.startsWith('+') ||
        trimmed.startsWith('-') ||
        trimmed.startsWith(' ') ||
        trimmed.includes('→');

      if (isDiffLine) {
        state.diffBuffer += line + '\n';
        continue;
      } else {
        // End of diff block reached
        state.inDiff = false;
        const diffText = state.diffBuffer.trim();
        state.diffBuffer = '';

        if (diffText) {
          const diffLines = render_inline_diff(diffText);
          // If a write tool was in flight, attach diff to it
          if (state.toolStartStack.length > 0 && ['write_file', 'patch'].includes(state.toolStartStack[state.toolStartStack.length - 1].name)) {
            const lastStart = state.toolStartStack.pop()!;
            events.push({
              type: 'tool_complete',
              toolId: lastStart.toolId,
              name: lastStart.name,
              args: lastStart.args,
              result: 'applied',
              inline_diff: diffText,
              inlineDiff: diffText,
              diffLines,
            });
          } else {
            events.push({
              type: 'diff',
              content: diffText,
              diffLines,
            });
          }
        }
        // Don't continue; fall through to evaluate current line
      }
    }

    // ── Tool complete: "┊ ✓ <emoji?> <verb> <detail> <duration>s" ──
    const toolCompleteMatch = trimmed.match(/^[│┊]\s*(?:([✓✗])\s+)?(?:(\p{Extended_Pictographic})\s+)?(\S+)(.*)$/u);
    if (toolCompleteMatch) {
      const failureMark = toolCompleteMatch[1] === '✗' ? '✗' : '';
      const emoji = toolCompleteMatch[2];
      const verb = toolCompleteMatch[3];
      const rest = toolCompleteMatch[4].trim();

      // Guard: don't treat "preparing" or "review" as tool completion
      if (verb === 'preparing' || verb === 'prepares' || verb === 'review') {
        continue;
      }

      const durMatch = rest.match(/(\d+\.?\d*)\s*s$/);
      const duration_s = durMatch ? parseFloat(durMatch[1]) : undefined;
      const restClean = durMatch ? rest.slice(0, durMatch.index).trim() : rest;

      // Detect error
      const hasError = failureMark === '✗' || restClean.includes('[error]') || restClean.includes('[exit');
      const errorMatch = restClean.match(/\[([^\]]+)\]/);
      const error = hasError ? (errorMatch ? errorMatch[1] : 'error') : undefined;

      let name = verb;
      let toolId = `cli-comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      let args: Record<string, any> = {};

      if (state.toolStartStack.length > 0) {
        const lastStart = state.toolStartStack.pop()!;
        name = lastStart.name;
        toolId = lastStart.toolId;
        args = lastStart.args;
      } else {
        const verbMap: Record<string, string> = {
          read: 'read_file',
          wrote: 'write_file',
          patched: 'patch',
          searched: 'web_search',
          found: 'search_files',
          browsed: 'browser_navigate',
          clicked: 'browser_click',
          typed: 'browser_type',
          ran: 'terminal',
        };
        name = verbMap[verb.toLowerCase()] || verb;
      }

      const evt: ToolCompleteEvent = {
        type: 'tool_complete',
        toolId,
        name,
        args,
        result: restClean || '',
        duration_s,
        durationS: duration_s,
        error,
      };
      events.push(evt);
      continue;
    }

    // ── Skip metadata lines ──
    if (
      trimmed.startsWith('Query:') || trimmed.startsWith('Session:') ||
      trimmed.startsWith('Detected file:') || trimmed.match(/^─+$/) ||
      trimmed.startsWith('Resume this session with:') || trimmed.startsWith('hermes --resume') ||
      trimmed.startsWith('Duration:') || trimmed.startsWith('Messages:') ||
      trimmed.startsWith('Exit code:') || trimmed.startsWith('↻') ||
      trimmed.match(/Resumed session/) || trimmed.startsWith('Initializing agent')
    ) {
      continue;
    }
  }

  return events;
}

/** Best-effort arg extraction from tool preview string */
function extractArgsFromPreview(toolName: string, previewText: string): Record<string, any> {
  const args: Record<string, any> = {};
  const primaryKey = PRIMARY_ARGS[toolName];

  if (primaryKey === 'path') {
    const pathMatch = previewText.match(/\S+/);
    if (pathMatch) args.path = pathMatch[0];
  } else if (primaryKey === 'command') {
    args.command = previewText;
  } else if (primaryKey === 'query') {
    args.query = previewText;
  } else if (primaryKey === 'url') {
    const urlMatch = previewText.match(/https?:\/\/\S+/);
    if (urlMatch) args.url = urlMatch[0];
  } else if (primaryKey === 'pattern') {
    args.pattern = previewText;
  } else if (primaryKey === 'code') {
    args.code = previewText;
  } else if (primaryKey === 'goal') {
    args.goal = previewText;
  } else if (primaryKey === 'question') {
    args.question = previewText;
  } else if (primaryKey === 'name') {
    args.name = previewText;
  }

  return args;
}

// ── Format events for display ──

export function formatToolStartEvt(evt: ToolStartEvent, previewMaxLen: number = 80): string {
  return tool_start_line(evt.name, evt.args, previewMaxLen);
}

export function formatToolCompleteEvt(evt: ToolCompleteEvent, previewMaxLen: number = 80): string {
  return tool_complete_line(evt.name, evt.args, evt.result, evt.duration_s, previewMaxLen);
}
