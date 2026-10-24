/**
 * Clap Detector — Manages the Python clap detection subprocess.
 * Listens for double-clap events to trigger Echo Mode.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';
import { loadOverlayConfig } from './config';
import { toggleVisibility, getMainWindow, getIsVisible } from './window';

let clapDetector: ChildProcess | null = null;

export function startClapDetector() {
  if (clapDetector) return;
  const config = loadOverlayConfig();
  if (config.echoClapWakeEnabled !== true) {
    console.log('[ClapDetector] Not starting — echoClapWakeEnabled is false');
    return;
  }

  const hermesAgentVenvPython = path.join(
    os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'
  );

  const scriptPaths = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'audio', 'clap_detector.py'),
    path.join(__dirname, '..', 'src', 'audio', 'clap_detector.py'),
    path.join(app.getAppPath(), 'src', 'audio', 'clap_detector.py'),
    path.join(app.getAppPath(), '..', 'src', 'audio', 'clap_detector.py'),
  ];

  let clapScriptPath = '';
  for (const p of scriptPaths) {
    if (fs.existsSync(p)) { clapScriptPath = p; break; }
  }

  if (!clapScriptPath) {
    console.error('[ClapDetector] Could not find clap_detector.py');
    return;
  }

  console.log('[ClapDetector] Starting...');
  const sensitivity = config.echoClapSensitivity ?? 0.5;
  const args = [clapScriptPath, '--sensitivity', String(sensitivity)];
  clapDetector = spawn(hermesAgentVenvPython, args);

  clapDetector.stdout?.on('data', (data: Buffer) => {
    try {
      const msgs = data.toString().trim().split('\n');
      for (const msgStr of msgs) {
        if (!msgStr) continue;
        const msg = JSON.parse(msgStr);

        if (msg.type === 'double_clap') {
          console.log('[ClapDetector] DOUBLE CLAP DETECTED!');
          const win = getMainWindow();
          if (!win) return;

          const currentConfig = loadOverlayConfig();
          if (!getIsVisible()) {
            toggleVisibility();
            win.webContents.send('enter-echo-mode');
          } else if (currentConfig.echoDoubleClapMinimize) {
            toggleVisibility();
          }
        }
      }
    } catch (e) {
      console.error('[ClapDetector] Error parsing output:', e);
    }
  });

  clapDetector.stderr?.on('data', (data: Buffer) => {
    console.error('[ClapDetector] Log:', data.toString());
  });

  clapDetector.on('error', (err) => {
    console.error('[ClapDetector] Failed to start:', err);
  });

  clapDetector.on('close', (code) => {
    console.log('[ClapDetector] Exited with code:', code);
    clapDetector = null;
  });
}

export function stopClapDetector() {
  if (clapDetector && !clapDetector.killed) {
    clapDetector.kill();
    clapDetector = null;
  }
}

export function restartClapDetector() {
  stopClapDetector();
  startClapDetector();
}
