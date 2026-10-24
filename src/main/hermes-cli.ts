/** Hermes CLI process bridge. Uses Hermes' JSONL protocol instead of scraping TUI borders. */

import { spawn, type ChildProcess } from 'child_process';
import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { hermesDir, loadOverlayConfig } from './config';
import { HermesJsonlParser } from './hermes-stream-json';

let activeChild: ChildProcess | null = null;
let activeRunId = 0;
let activeRunTimeout: NodeJS.Timeout | null = null;
const abortedChildren = new WeakSet<ChildProcess>();
const sessionMap = new Map<string, string>();
const sessionMapPath = path.join(hermesDir, 'spotlight_session_map.json');
const sessionModelMap = new Map<string, { provider: string; model: string }>();
const sessionModelMapPath = path.join(hermesDir, 'spotlight_session_models.json');

function loadSessionMap() {
  try {
    if (fs.existsSync(sessionMapPath)) {
      const data = JSON.parse(fs.readFileSync(sessionMapPath, 'utf8'));
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') sessionMap.set(key, value);
      }
    }
  } catch {
    // A stale or partial map should not prevent the app from opening.
  }
  try {
    if (!fs.existsSync(sessionModelMapPath)) return;
    const data = JSON.parse(fs.readFileSync(sessionModelMapPath, 'utf8'));
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object'
        && typeof (value as any).provider === 'string'
        && typeof (value as any).model === 'string') {
        sessionModelMap.set(key, value as { provider: string; model: string });
      }
    }
  } catch {
    // Missing or stale selection metadata simply starts a fresh chat session.
  }
}

function saveSessionMap() {
  try {
    const entries = [...sessionMap.entries()].slice(-100);
    fs.mkdirSync(path.dirname(sessionMapPath), { recursive: true });
    fs.writeFileSync(sessionMapPath, JSON.stringify(Object.fromEntries(entries), null, 2), 'utf8');
  } catch {
    // Session persistence is best effort.
  }
  try {
    const entries = [...sessionModelMap.entries()].slice(-100);
    fs.mkdirSync(path.dirname(sessionModelMapPath), { recursive: true });
    fs.writeFileSync(sessionModelMapPath, JSON.stringify(Object.fromEntries(entries), null, 2), 'utf8');
  } catch {
    // Selection persistence is best effort.
  }
}

loadSessionMap();

export function getActiveChild(): ChildProcess | null {
  return activeChild;
}

export function killActiveChild() {
  if (activeRunTimeout) clearTimeout(activeRunTimeout);
  activeRunTimeout = null;
  if (!activeChild || activeChild.killed) return;
  abortedChildren.add(activeChild);
  activeChild.kill();
  activeChild = null;
}

export function registerSessionMapping(
  overlaySessionId: string,
  hermesSessionId: string,
  selection?: { provider: string; model: string },
) {
  if (!overlaySessionId || !hermesSessionId) return;
  sessionMap.set(overlaySessionId, hermesSessionId);
  if (selection) sessionModelMap.set(overlaySessionId, selection);
  saveSessionMap();
}

export function getMappedHermesSessionId(overlaySessionId: string): string | undefined {
  return sessionMap.get(overlaySessionId);
}

export function sendInputToChild(input: string) {
  // The current CLI transport is one-shot. Kept for the legacy voice pipeline.
  if (activeChild && !activeChild.killed && activeChild.stdin?.writable) activeChild.stdin.write(input);
}

export interface SendMessageData {
  text: string;
  file?: string;
  sessionId: string;
  toolMode: string;
  provider?: string;
  model?: string;
}

export function sendMessage(mainWindow: BrowserWindow, data: SendMessageData) {
  let runId: number | undefined;
  const send = (channel: string, payload?: unknown) => {
    if ((runId === undefined || runId === activeRunId)
      && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  const config = loadOverlayConfig();
  const provider = data.provider || config.activeProvider;
  const model = data.model || config.activeModel;
  const mappedSessionId = sessionMap.get(data.sessionId);
  const priorSelection = sessionModelMap.get(data.sessionId);
  const selectionMatches = Boolean(priorSelection
    && priorSelection.provider === (provider || '')
    && priorSelection.model === (model || ''));
  // Hermes locks the launch provider/model into its session. Resume only when
  // the current selection still matches; older mappings with no metadata start
  // fresh so they cannot pin the UI to a stale provider indefinitely.
  const hermesSessionId = mappedSessionId && selectionMatches ? mappedSessionId : undefined;
  const args = ['chat'];
  if (hermesSessionId) args.push('--resume', hermesSessionId);
  // Hermes preserves a resumed session's launch policy. Passing provider/model
  // overrides on resume can make valid gateway sessions fail before streaming.
  // Apply the selected defaults only when creating a fresh Hermes session.
  if (!hermesSessionId) {
    // A one-shot request from this overlay is still being read by a person.
    // Explicitly mark new sessions as attended so Hermes can use its
    // short-wait/fallback path for long free-tier cooldowns. The gateway
    // accepts the `cli` source; resumed sessions inherit their launch policy.
    args.push('--source', 'cli');
    if (provider) args.push('--provider', provider);
    if (model) args.push('--model', model);
  }
  if (data.toolMode === 'none') args.push('-t', '');
  else if (data.toolMode === 'terminal') args.push('-t', 'terminal');

  if (data.file && /\.(png|jpe?g|gif|webp|bmp)$/i.test(data.file)) {
    args.push('--image', data.file);
  }

  const parser = new HermesJsonlParser();
  const stderrParser = new HermesJsonlParser();
  let stderr = '';
  let queryDir: string | undefined;
  try {
    queryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-spotlight-'));
    const queryPath = path.join(queryDir, `${randomUUID()}.txt`);
    const queryText = data.file && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(data.file)
      ? `[User attached a file at: ${data.file}]\n\n${data.text}`
      : data.text;
    fs.writeFileSync(queryPath, queryText, 'utf8');
    args.push('-Q', '--format', 'stream-json', '--query-file', queryPath);

    runId = ++activeRunId;
    killActiveChild();
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const overlayPythonHooks = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'hermes-overlay-python')
      : path.resolve(__dirname, '../../scripts/hermes-overlay-python');
    childEnv.PYTHONPATH = [overlayPythonHooks, childEnv.PYTHONPATH]
      .filter(Boolean)
      .join(path.delimiter);
    const child = spawn(process.platform === 'win32' ? 'hermes.exe' : 'hermes', args, {
      cwd: os.homedir(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnv,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        TERM: 'dumb',
        HERMES_OVERLAY: '1',
      },
    });
    activeChild = child;
    const armNoProgressTimeout = () => {
      if (activeRunTimeout) clearTimeout(activeRunTimeout);
      activeRunTimeout = setTimeout(() => {
        if (runId !== activeRunId || activeChild !== child) return;
        abortedChildren.add(child);
        child.kill();
        activeChild = null;
        send('stream-error', 'Hermes did not return anything for 2 minutes. Check the selected provider and try again.');
      }, 120_000);
    };
    armNoProgressTimeout();

    const handleEvents = (events: ReturnType<HermesJsonlParser['push']>) => {
      for (const event of events) {
        if (event.type === 'session') {
          registerSessionMapping(data.sessionId, event.sessionId, { provider: provider || '', model: model || '' });
        } else if (event.type === 'status') {
          send('stream-segment', { type: 'status', tokens: event.tokens, durationS: event.durationS });
        } else if (event.type === 'error') {
          send('stream-error', event.message);
        } else {
          if (event.segment.type === 'tool_complete' && event.segment.name === 'clarify') {
            // The tool result is persisted before Hermes emits tool.completed. Stop the
            // headless run here so it cannot continue past the question and race the
            // user's answer, which starts the next run in this same session.
            if (activeChild) killActiveChild();
            continue;
          }
          send('stream-segment', event.segment);
        }
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      armNoProgressTimeout();
      handleEvents(parser.push(chunk));
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-6000);
      // Hermes announces gateway-created session IDs on stderr. Parse this
      // stream separately so it cannot corrupt partial JSONL records on stdout.
      for (const event of stderrParser.push(chunk)) {
        if (event.type === 'session') registerSessionMapping(data.sessionId, event.sessionId, { provider: provider || '', model: model || '' });
      }
    });

    child.on('error', (error) => {
      if (activeRunTimeout) clearTimeout(activeRunTimeout);
      activeRunTimeout = null;
      send('stream-error', error.message || 'Could not start Hermes. Check that Hermes is installed and on PATH.');
      if (activeChild === child) activeChild = null;
    });

    child.on('close', (code) => {
      try { fs.rmSync(queryDir!, { recursive: true, force: true }); } catch { /* temporary file cleanup */ }
      if (runId !== activeRunId) return;
      if (activeRunTimeout) clearTimeout(activeRunTimeout);
      activeRunTimeout = null;
      for (const event of stderrParser.finish()) {
        if (event.type === 'session') registerSessionMapping(data.sessionId, event.sessionId, { provider: provider || '', model: model || '' });
      }
      handleEvents(parser.finish());
      const wasAborted = abortedChildren.has(child);
      if (code !== 0 && !wasAborted) {
        const details = stderr.trim().replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]');
        send('stream-error', details.slice(-1200) || `Hermes exited with code ${code ?? 'unknown'}.`);
      }
      send('stream-end', { code });
      if (activeChild === child) activeChild = null;
    });
  } catch (error: any) {
    try { if (queryDir) fs.rmSync(queryDir, { recursive: true, force: true }); } catch { /* temporary file cleanup */ }
    send('stream-error', error?.message || 'Failed to start Hermes.');
  }
}
