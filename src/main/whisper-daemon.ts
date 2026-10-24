/**
 * Whisper Daemon — Manages a persistent Python process with
 * preloaded Whisper model for instant transcription fallback.
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
let pendingQueue: Array<{
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  filePath: string;
}> = [];
let outputBuffer = '';

const hermesAgentVenvPython = path.join(
  os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'
);

function findDaemonScript(): string {
  const candidates = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'audio', 'whisper_daemon.py'),
    path.join(__dirname, '..', 'src', 'audio', 'whisper_daemon.py'),
    path.join(app.getAppPath(), 'src', 'audio', 'whisper_daemon.py'),
    path.join(app.getAppPath(), '..', 'src', 'audio', 'whisper_daemon.py'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

export function startWhisperDaemon(): void {
  if (daemon && !daemon.killed) return;

  const scriptPath = findDaemonScript();
  if (!scriptPath) {
    console.error('[WhisperDaemon] Could not find whisper_daemon.py');
    return;
  }

  console.log('[WhisperDaemon] Starting...');

  daemon = spawn(hermesAgentVenvPython, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  daemon.stdout?.on('data', (data: Buffer) => {
    outputBuffer += data.toString();
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop() || ''; // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.init === 'ready') {
          daemonReady = true;
          console.log('[WhisperDaemon] Model loaded and ready');
          // Flush pending queue
          flushPending();
        } else if (msg.ok === true && msg.text !== undefined) {
          // Transcription result
          const next = pendingQueue.shift();
          if (next) next.resolve(msg.text);
        } else if (msg.ok === false && msg.error) {
          const next = pendingQueue.shift();
          if (next) next.reject(new Error(msg.error));
        }
      } catch (_) {
        // non-JSON output (debug, etc.) — ignore
      }
    }
  });

  daemon.stderr?.on('data', (data: Buffer) => {
    console.error('[WhisperDaemon] stderr:', data.toString().trim());
  });

  daemon.on('error', (err) => {
    console.error('[WhisperDaemon] Process error:', err.message);
    daemonReady = false;
    rejectAll(new Error(`Whisper daemon error: ${err.message}`));
    daemon = null;
  });

  daemon.on('close', (code) => {
    console.log('[WhisperDaemon] Exited with code:', code);
    daemonReady = false;
    rejectAll(new Error('Whisper daemon exited'));
    daemon = null;
  });
}

export function stopWhisperDaemon(): void {
  if (!daemon || daemon.killed) return;
  try {
    daemon.stdin?.write(JSON.stringify({ op: 'quit' }) + '\n');
  } catch (_) {}
  setTimeout(() => {
    if (daemon && !daemon.killed) daemon.kill();
  }, 2000);
}

export function transcribeViaDaemon(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    pendingQueue.push({ resolve, reject, filePath });

    if (!daemon || daemon.killed) {
      startWhisperDaemon();
      return; // Will be processed when ready
    }

    if (daemonReady) {
      try {
        daemon.stdin?.write(JSON.stringify({ op: 'transcribe', path: filePath }) + '\n');
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

function flushPending(): void {
  for (const q of pendingQueue) {
    try {
      daemon?.stdin?.write(JSON.stringify({ op: 'transcribe', path: q.filePath }) + '\n');
    } catch (e) {
      // Do nothing, will handle in error/close
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