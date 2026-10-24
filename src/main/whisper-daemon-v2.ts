/**
 * Whisper Daemon V2 — Manages a persistent Python process with
 * preloaded faster-whisper model for instant transcription.
 *
 * Uses whisper_daemon_v2.py which adds:
 * - GPU support (CUDA via ctranslate2)
 * - Streaming partial transcripts
 * - Health check
 * - CPU fallback if GPU fails
 *
 * Eliminates 1-2s model-load latency per STT call by loading
 * the model once at app startup and keeping it alive.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';

let daemon: ChildProcess | null = null;
let daemonReady = false;
let usingGPU = false;
let pendingQueue: Array<{
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  filePath: string;
  stream: boolean;
}> = [];
let outputBuffer = '';

const hermesAgentVenvPython = path.join(
  os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'
);

function resolveAudioScript(scriptName: string): string {
  const candidateBases = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'audio'),
    path.join(__dirname, '..', 'src', 'audio'),
    path.join(__dirname, '..', '..', 'src', 'audio'),
    path.join(__dirname, '..', '..', '..', 'src', 'audio'),
    path.join(app.getAppPath(), 'src', 'audio'),
    path.join(app.getAppPath(), '..', 'src', 'audio'),
    path.join(app.getAppPath(), '..', '..', 'src', 'audio'),
  ];
  for (const base of candidateBases) {
    const candidate = path.join(base, scriptName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

export function startWhisperDaemon(): void {
  if (daemon && !daemon.killed) return;

  const scriptPath = resolveAudioScript('whisper_daemon_v2.py') || resolveAudioScript('whisper_daemon.py');
  if (!scriptPath) {
    console.error('[WhisperDaemonV2] Could not find daemon script');
    return;
  }

  const isV2 = scriptPath.includes('whisper_daemon_v2.py');
  console.log(`[WhisperDaemonV2] Starting ${isV2 ? 'V2 (GPU)' : 'V1 (CPU)'}: ${scriptPath}`);

  // Set CUDA library paths in the environment
  const venvNvidia = path.join(
    os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent',
    'venv', 'Lib', 'site-packages', 'nvidia'
  );
  const env = { ...process.env };
  for (const sub of ['cublas', 'cudnn', 'cuda_runtime']) {
    const bindir = path.join(venvNvidia, sub, 'bin');
    if (fs.existsSync(bindir)) {
      env.PATH = bindir + (env.PATH ? path.delimiter + env.PATH : '');
    }
  }
  // Request GPU by default
  if (!env.WHISPER_DAEMON_DEVICE) env.WHISPER_DAEMON_DEVICE = 'cuda';
  if (!env.WHISPER_DAEMON_MODEL) env.WHISPER_DAEMON_MODEL = 'base';

  daemon = spawn(hermesAgentVenvPython, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  daemon.stdout?.on('data', (data: Buffer) => {
    outputBuffer += data.toString();
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop() || ''; // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleDaemonMessage(msg);
      } catch {
        // non-JSON output (debug, etc.) — ignore
      }
    }
  });

  daemon.stderr?.on('data', (data: Buffer) => {
    console.error('[WhisperDaemonV2] stderr:', data.toString().trim());
  });

  daemon.on('error', (err) => {
    console.error('[WhisperDaemonV2] Process error:', err.message);
    daemonReady = false;
    rejectAll(new Error(`Whisper daemon error: ${err.message}`));
    daemon = null;
  });

  daemon.on('close', (code) => {
    console.log('[WhisperDaemonV2] Exited with code:', code);
    daemonReady = false;
    rejectAll(new Error('Whisper daemon exited'));
    daemon = null;
  });
}

function handleDaemonMessage(msg: any) {
  if (msg.init === 'ready') {
    daemonReady = true;
    usingGPU = msg.device === 'cuda';
    console.log(
      `[WhisperDaemonV2] Ready — model=${msg.model}, device=${msg.device}, ` +
      `compute=${msg.compute}, load=${msg.load_time_s}s`
    );
    flushPending();
  } else if (msg.init === 'error') {
    console.error('[WhisperDaemonV2] Init error:', msg.error);
    rejectAll(new Error(msg.error));
  } else if (msg.ok === true && msg.text !== undefined) {
    // Transcription result (batch or streaming partial)
    const next = pendingQueue[0];
    if (next) {
      if (msg.partial) {
        // Streaming partial — don't resolve yet, just log
        console.log(`[WhisperDaemonV2] Partial: "${msg.text.substring(0, 40)}..."`);
      } else {
        // Final result
        pendingQueue.shift();
        next.resolve(msg.text);
      }
    }
  } else if (msg.ok === true && msg.pong === true) {
    // Ping response
    console.log(`[WhisperDaemonV2] Ping OK — model=${msg.model}`);
  } else if (msg.ok === true && msg.healthy === true) {
    // Health check response
    console.log(
      `[WhisperDaemonV2] Health: gpu=${msg.gpu}, device=${msg.device}, ` +
      `vram=${msg.vram_mb}MB`
    );
  } else if (msg.ok === false && msg.error) {
    const next = pendingQueue.shift();
    if (next) next.reject(new Error(msg.error));
  }
}

export function stopWhisperDaemon(): void {
  if (!daemon || daemon.killed) return;
  try {
    daemon.stdin?.write(JSON.stringify({ op: 'quit' }) + '\n');
  } catch {}
  setTimeout(() => {
    if (daemon && !daemon.killed) daemon.kill();
  }, 2000);
}

/**
 * Transcribe a file via the daemon (batch mode).
 */
export function transcribeViaDaemon(filePath: string): Promise<string> {
  return enqueueTranscribe(filePath, false);
}

/**
 * Transcribe a file via the daemon with streaming partial results.
 * Partial results are emitted to the callback as they arrive.
 */
export function transcribeStreamViaDaemon(
  filePath: string,
  onPartial: (text: string) => void
): Promise<string> {
  // For now, same as batch — streaming partials arrive as stdout messages
  // but we resolve on the final. Partial callback is a future enhancement.
  return enqueueTranscribe(filePath, true);
}

function enqueueTranscribe(filePath: string, stream: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    pendingQueue.push({ resolve, reject, filePath, stream });

    if (!daemon || daemon.killed) {
      startWhisperDaemon();
      return; // Will be processed when ready
    }

    if (daemonReady) {
      const op = stream ? 'transcribe_stream' : 'transcribe';
      try {
        daemon.stdin?.write(JSON.stringify({ op, path: filePath }) + '\n');
      } catch (e) {
        const idx = pendingQueue.findIndex(q => q.resolve === resolve);
        if (idx >= 0) pendingQueue.splice(idx, 1);
        reject(new Error('Failed to send to daemon'));
      }
    }
  });
}

export function isWhisperDaemonReady(): boolean {
  return daemonReady && daemon !== null && !daemon!.killed;
}

export function isWhisperUsingGPU(): boolean {
  return usingGPU;
}

export function pingDaemon(): void {
  if (daemon && daemonReady) {
    try {
      daemon.stdin?.write(JSON.stringify({ op: 'ping' }) + '\n');
    } catch {}
  }
}

/**
 * Request a health check from the daemon.
 */
export function healthCheckDaemon(): void {
  if (daemon && daemonReady) {
    try {
      daemon.stdin?.write(JSON.stringify({ op: 'health' }) + '\n');
    } catch {}
  }
}

function flushPending(): void {
  for (const q of pendingQueue) {
    try {
      const op = q.stream ? 'transcribe_stream' : 'transcribe';
      daemon?.stdin?.write(JSON.stringify({ op, path: q.filePath }) + '\n');
    } catch {
      // Will handle in error/close
    }
  }
}

function rejectAll(err: Error): void {
  const remaining = [...pendingQueue];
  pendingQueue = [];
  for (const q of remaining) {
    q.reject(err);
  }
}
