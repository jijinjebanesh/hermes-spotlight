/**
 * Wake Detector — Manages the native Python wake-word subprocess.
 *
 * Responsibilities:
 * - Spawn wake_detector.py against the local Hermes agent venv
 * - Emit "enter-echo-mode" IPC to the renderer when a wake word is detected
 * - Auto-restart on transient crashes (zombie-free via SIGTERM + EOF)
 * - Surface errors via IPC so the renderer can show a status banner
 * - Stop cleanly on app quit
 *
 * Protocol (stdout, one JSON object per line):
 *   {"type":"wake_word","confidence":1.0,"transcript":"..."}
 *   {"type":"error","message":"mic_open_failed: ..."}
 *   {"type":"fatal","message":"..."}
 *
 * All Python diagnostics go to stderr → routed to the Electron console log.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app, BrowserWindow } from 'electron';
import { loadOverlayConfig } from './config';
import { toggleVisibility, getMainWindow, getIsVisible } from './window';

let wakeDetector: ChildProcess | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let consecutiveCrashes = 0;
const MAX_CONSECUTIVE_CRASHES = 3;       // give up after 3 crashes in quick succession
const RESTART_DELAY_MS = 1500;            // back-off between auto-restarts
const CRASH_WINDOW_MS = 30_000;           // crashes inside this window count toward the cap
let firstCrashTime = 0;

/** Current wake-detector state — inspected by the renderer via IPC. */
let lastStatus: {
  running: boolean;
  engine: 'native' | 'web';
  lastError: string | null;
} = { running: false, engine: 'native', lastError: null };

export function getWakeDetectorStatus() {
  return { ...lastStatus };
}

export function startWakeDetector() {
  if (wakeDetector) return;             // already running
  if (isShuttingDown) return;            // app is quitting — refuse new spawns

  const config = loadOverlayConfig();

  // Only the native engine needs the Python subprocess.
  // The "web" engine is driven from the renderer via WakeWordListener.tsx.
  const isEnabled = config.echoWakeWordEnabled || config.echoVoiceModeEnabled;
  if (!isEnabled || config.echoWakeWordEngine !== 'native') {
    console.log('[WakeDetector] Not starting (engine is not native or wake word is disabled).');
    lastStatus = { running: false, engine: config.echoWakeWordEngine || 'native', lastError: null };
    return;
  }

  const hermesAgentVenvPython = path.join(
    os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'
  );
  const pythonExecutable = fs.existsSync(hermesAgentVenvPython)
    ? hermesAgentVenvPython
    : 'python';
  if (pythonExecutable === 'python') {
    console.warn('[WakeDetector] Using fallback python from PATH');
  }

  const candidateBases = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'audio'),
    path.join(__dirname, '..', 'src', 'audio'),
    path.join(__dirname, '..', '..', 'src', 'audio'),
    path.join(__dirname, '..', '..', '..', 'src', 'audio'),
    path.join(app.getAppPath(), 'src', 'audio'),
    path.join(app.getAppPath(), '..', 'src', 'audio'),
    path.join(app.getAppPath(), '..', '..', 'src', 'audio'),
  ];
  const detectorScriptPath = candidateBases
    .map(base => path.join(base, 'wake_detector.py'))
    .find(p => fs.existsSync(p));
  if (!detectorScriptPath) {
    const msg = 'Could not find wake_detector.py';
    console.error('[WakeDetector]', msg);
    lastStatus = { running: false, engine: 'native', lastError: msg };
    return;
  }

  const phrase = (config.echoWakeWord && config.echoWakeWord.trim())
    ? config.echoWakeWord.trim()
    : 'hey hermes';
  console.log(`[WakeDetector] Starting native AI for phrase: "${phrase}"`);

  const args = [detectorScriptPath, '--phrase', phrase];
  try {
    wakeDetector = spawn(pythonExecutable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    const msg = `Spawn failed: ${(err as Error).message}`;
    console.error('[WakeDetector]', msg);
    lastStatus = { running: false, engine: 'native', lastError: msg };
    return;
  }

  lastStatus = { running: true, engine: 'native', lastError: null };

  wakeDetector.stdout?.on('data', (data: Buffer) => {
    // Each line is one JSON object — buffer fragments in case of partial reads.
    const text = data.toString();
    for (const msgStr of text.split('\n')) {
      const trimmed = msgStr.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        handleWakeMessage(msg);
      } catch {
        // Not JSON — ignore. Logs go via stderr below.
      }
    }
  });

  wakeDetector.stderr?.on('data', (data: Buffer) => {
    console.log('[WakeDetector log]', data.toString().trim());
  });

  wakeDetector.on('error', (err) => {
    console.error('[WakeDetector] Process error:', err);
    lastStatus = { running: false, engine: 'native', lastError: err.message };
  });

  wakeDetector.on('close', (code, signal) => {
    console.log(`[WakeDetector] Exited code=${code} signal=${signal}`);
    wakeDetector = null;

    // If we initiated the shutdown, don't auto-restart.
    if (isShuttingDown) {
      lastStatus = { running: false, engine: 'native', lastError: null };
      return;
    }

    // Non-zero exit / unexpected close → schedule a restart with cap + back-off
    if (code !== 0 && code !== null) {
      const now = Date.now();
      if (firstCrashTime === 0) firstCrashTime = now;
      if (now - firstCrashTime > CRASH_WINDOW_MS) {
        // Window reset — start a fresh crash count
        firstCrashTime = now;
        consecutiveCrashes = 0;
      }
      consecutiveCrashes += 1;
      if (consecutiveCrashes > MAX_CONSECUTIVE_CRASHES) {
        const msg = `Native wake detector crashed ${consecutiveCrashes} times — giving up. Check logs.`;
        console.error('[WakeDetector]', msg);
        lastStatus = { running: false, engine: 'native', lastError: msg };
        consecutiveCrashes = 0;
        firstCrashTime = 0;
        return;
      }
      console.log(`[WakeDetector] Restarting in ${RESTART_DELAY_MS}ms (crash ${consecutiveCrashes}/${MAX_CONSECUTIVE_CRASHES})...`);
      lastStatus = { running: false, engine: 'native', lastError: `crashed (exit ${code})` };
      restartTimer = setTimeout(() => {
        restartTimer = null;
        startWakeDetector();
      }, RESTART_DELAY_MS);
    } else {
      lastStatus = { running: false, engine: 'native', lastError: null };
    }
  });
}

function handleWakeMessage(msg: any) {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'wake_word': {
      console.log('[WakeDetector] NATIVE WAKE WORD DETECTED:', msg.transcript || '');
      const win = getMainWindow();
      if (!win) return;

      if (!getIsVisible()) {
        // Surface the window first; send the mode-enter signal after a microtask
        // so the renderer is mounted and ready to handle it. Without this delay,
        // 'enter-echo-mode' can be dropped on a just-shown window.
        toggleVisibility();
        BrowserWindow.fromId(win.id)?.once('ready-to-show', () => {
          win.webContents.send('enter-echo-mode');
        });
        // Safety net: if 'ready-to-show' never fires (window already visible),
        // still fire the IPC after a short tick.
        setTimeout(() => {
          try {
            if (getMainWindow()) win.webContents.send('enter-echo-mode');
          } catch {
            /* window may have been destroyed between the timer firing and now */
          }
        }, 50);
      } else {
        win.webContents.send('enter-echo-mode');
      }
      break;
    }
    case 'error': {
      console.warn('[WakeDetector] Error from subprocess:', msg.message);
      lastStatus = { running: lastStatus.running, engine: 'native', lastError: String(msg.message) };
      break;
    }
    case 'fatal': {
      console.error('[WakeDetector] Fatal from subprocess:', msg.message);
      lastStatus = { running: false, engine: 'native', lastError: String(msg.message) };
      break;
    }
    default:
      // Unknown message — ignore
      break;
  }
}

export function stopWakeDetector() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  isShuttingDown = true;
  if (wakeDetector && !wakeDetector.killed) {
    // On Windows SIGTERM is not deliverable to py.exe children — `kill()`
    // calls TerminateProcess. Closing stdin gives Python a chance to see EOF
    // and shut down gracefully if it was reading stdin for commands (future use).
    try {
      if (wakeDetector.stdin && !wakeDetector.stdin.destroyed) wakeDetector.stdin.end();
    } catch {
      /* stdin already closed */
    }
    try {
      wakeDetector.kill();
    } catch {
      /* already dead */
    }
    // Force-kill after a short grace period if still alive
    const proc = wakeDetector;
    setTimeout(() => {
      if (proc && !proc.killed) {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, 500);
    wakeDetector = null;
  }
  lastStatus = { running: false, engine: 'native', lastError: lastStatus.lastError };
}

export function restartWakeDetector() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  // Reset crash count on a deliberate user-initiated restart; settings change
  // is a clean restart, not an auto-recovery from a crash.
  consecutiveCrashes = 0;
  firstCrashTime = 0;
  // Allow the spawn to run again: stopWakeDetector sets isShuttingDown=true;
  // here we clear it because this is a deliberate restart mid-session.
  isShuttingDown = false;
  stopWakeDetector();
  isShuttingDown = false;
  startWakeDetector();
}
