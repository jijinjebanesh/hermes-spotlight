import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const electronEnv = { ...process.env };
delete electronEnv.ELECTRON_RUN_AS_NODE;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  stdio: 'inherit',
  windowsHide: true,
});
let electron;
let stopped = false;

function stop() {
  if (stopped) return;
  stopped = true;
  vite.kill();
  electron?.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', (code) => {
  if (!stopped && code !== 0) process.exitCode = code ?? 1;
  if (!stopped) stop();
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5173');
      ready = response.ok;
    } catch {
      await delay(250);
    }
  }
  if (!ready) throw new Error('Vite did not start on http://127.0.0.1:5173');
  electron = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    windowsHide: false,
    env: { ...electronEnv, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
  });
  electron.on('exit', (code) => {
    if (!stopped) {
      process.exitCode = code ?? 0;
      stop();
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  stop();
}
