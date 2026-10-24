/**
 * IPC Handlers — All ipcMain handler registrations.
 * Organized by domain: config, inventory, files, sessions, settings, echo.
 */

import { ipcMain, dialog, desktopCapturer, screen, shell, app, globalShortcut, clipboard, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { hermesDir, loadOverlayConfig, saveOverlayConfig, sessionsDir, setHermesModel } from './config';
import { getMainWindow, toggleVisibility, getIsVisible, clampToScreen, resizeWindowToContent, setOverlayHorizontalPosition } from './window';
import { sendMessage, killActiveChild, sendInputToChild, registerSessionMapping, getMappedHermesSessionId } from './hermes-cli';
import { transcribeViaDaemon } from './whisper-daemon';
import { HermesJsonlParser } from './hermes-stream-json';

// ── Background Task Tracker ──
interface BackgroundTask {
  id: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed';
  output: string;
  startTime: number;
  endTime?: number;
  hermesSessionId?: string;
}

const backgroundTasks = new Map<string, BackgroundTask>();
const activeEchoProcesses = new Map<string, ChildProcess>();
const activeEchoTtsProcesses = new Map<string, Set<ChildProcess>>();

const scriptsDir = path.join(__dirname, '..', 'scripts');
const unpackedScriptsDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts');
const hermesAgentVenvPython = path.join(hermesDir, 'hermes-agent', 'venv', 'Scripts', 'python.exe');
const pythonExecutable = fs.existsSync(hermesAgentVenvPython) ? hermesAgentVenvPython : 'python';
const cliPath = path.join(hermesDir, 'hermes-agent', 'cli.py');

function findScript(name: string): string {
  const paths = [
    // External processes (Python, shells) cannot read inside app.asar, so in
    // packaged builds the script must come from app.asar.unpacked.
    path.join(unpackedScriptsDir, name),
    path.join(scriptsDir, name),
    path.join(app.getAppPath(), 'scripts', name),
    path.join(__dirname, '..', '..', 'scripts', name),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function updateAhkScript(electronHotkey: string) {
  let ahkModifier = '';
  const parts = electronHotkey.split('+');
  const key = parts.pop() || '';

  for (const mod of parts) {
    if (mod === 'CommandOrControl' || mod === 'Control' || mod === 'Ctrl') ahkModifier += '^';
    else if (mod === 'Alt') ahkModifier += '!';
    else if (mod === 'Shift') ahkModifier += '+';
    else if (mod === 'Meta' || mod === 'Command' || mod === 'Super') ahkModifier += '#';
  }

  const keyMapped = key.toLowerCase();
  const ahkHotkey = ahkModifier + keyMapped;
  const killHotkey = '^+' + keyMapped;

  const ahkPaths = [
    path.join(__dirname, '..', '..', 'hotkey.ahk'),
    path.join(app.getAppPath(), '..', 'hotkey.ahk'),
    path.join(app.getAppPath(), '..', '..', 'hotkey.ahk'),
  ];

  let ahkPath = '';
  for (const p of ahkPaths) {
    if (fs.existsSync(p)) { ahkPath = p; break; }
  }
  if (!ahkPath) return;

  try {
    const friendlyName = electronHotkey.replace('CommandOrControl', 'Ctrl');
    const lines = fs.readFileSync(ahkPath, 'utf8').split('\n');
    let triggerReplaced = false;
    for (let i = 0; i < lines.length; i++) {
      if (!triggerReplaced && lines[i].match(/^[^;].*?::\s*\{/)) {
        lines[i] = `${ahkHotkey}:: {`;
        triggerReplaced = true;
      } else if (triggerReplaced && lines[i].match(/^[^;].*?::\s*\{/)) {
        lines[i] = `${killHotkey}:: {`;
      } else if (lines[i].includes('Hotkey Active')) {
        lines[i] = `ToolTip("${friendlyName} Daemon Active — Press ${friendlyName} to toggle Hermes", 10, 10)\n`;
      } else if (lines[i].includes('F2') && lines[i].trim().startsWith(';')) {
        lines[i] = lines[i].replace(/F2/g, friendlyName || 'hotkey');
      }
    }
    fs.writeFileSync(ahkPath, lines.join('\n'), 'utf8');
    spawn('cmd.exe', ['/c', 'start', '', ahkPath], { detached: true, stdio: 'ignore' });
  } catch (e) {
    console.error('Failed to update AHK script', e);
  }
}

export function registerIpcHandlers() {
  const mainWindow = getMainWindow;

  // ── Config ──
  ipcMain.handle('get-config', async () => loadOverlayConfig());

  // ── Inventory ──
  ipcMain.handle('get-inventory', async () => {
    return new Promise((resolve) => {
      try {
        const scriptPath = findScript('model_inventory.py');
        if (!scriptPath) {
          resolve({ error: 'model_inventory.py not found', providers: [], model: '', provider: '' });
          return;
        }
        // Hermes installs its Python dependencies into its own venv. Using the
        // machine's `python` can silently return an empty inventory when those
        // packages (for example ruamel) are not installed globally.
        const child = spawn(pythonExecutable, [scriptPath], {
          timeout: 30000, env: { ...process.env },
        });
        let stdout = '', stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('close', () => {
          try {
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const inventory = JSON.parse(jsonMatch[0]);
              const selected = loadOverlayConfig();
              resolve({
                ...inventory,
                provider: selected.activeProvider || inventory.provider || '',
                model: selected.activeModel || inventory.model || '',
              });
            } else resolve({ error: 'No JSON output', providers: [], model: '', provider: '' });
          } catch (e: any) {
            resolve({ error: e.message, providers: [], model: '', provider: '' });
          }
        });
        child.on('error', (err: any) => {
          resolve({ error: err.message, providers: [], model: '', provider: '' });
        });
      } catch (e: any) {
        resolve({ error: e.message, providers: [], model: '', provider: '' });
      }
    });
  });

  // ── Model/Provider ──
    ipcMain.on('set-provider-model', (_e, provider: string, model: string) => {
      saveOverlayConfig({ activeProvider: provider, activeModel: model });
      const result = setHermesModel(provider, model);
      if (!result.success) console.warn('[ModelPicker] Could not sync Hermes defaults:', result.error);
    });

    // Apply provider/model (returns success status for UI)
    ipcMain.handle('apply-provider-model', async (_e, { provider, model }: { provider: string; model: string }) => {
      saveOverlayConfig({ activeProvider: provider, activeModel: model });
      const result = setHermesModel(provider, model);
      return { success: result.success, provider, model, error: result.error };
    });

  // ── Session management ──
  ipcMain.on('save-session', (_e, data: { sessionId: string; markdown: string }) => {
    const savePath = path.join(sessionsDir, `${data.sessionId}.md`);
    fs.writeFileSync(savePath, data.markdown);
  });

  ipcMain.on('register-session-mapping', (_e, overlaySessionId: string, hermesSessionId: string) => {
    registerSessionMapping(overlaySessionId, hermesSessionId);
  });

  ipcMain.handle('clear-all-sessions', async () => {
    try {
      if (!fs.existsSync(sessionsDir)) return true;
      const files = fs.readdirSync(sessionsDir);
      for (const file of files) {
        if (file.endsWith('.md')) fs.unlinkSync(path.join(sessionsDir, file));
      }
      return true;
    } catch (e) {
      console.error('Failed to clear sessions', e);
      return false;
    }
  });

  ipcMain.handle('list-sessions', async () => {
    return new Promise((resolve) => {
      try {
        const scriptPath = findScript('list_sessions.py');
        if (!scriptPath) { resolve([]); return; }
        const child = spawn(pythonExecutable, [scriptPath], {
          shell: true, timeout: 5000, env: { ...process.env },
        });
        let stdout = '';
        child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr?.on('data', () => {});
        child.on('close', () => {
          try {
            const jsonMatch = stdout.match(/\[[\s\S]*\]/);
            if (jsonMatch) resolve(JSON.parse(jsonMatch[0]));
            else resolve([]);
          } catch (e) { resolve([]); }
        });
        child.on('error', () => resolve([]));
        // Hard timeout — never let this hang the UI
        setTimeout(() => { try { child.kill(); } catch {} resolve([]); }, 6000);
      } catch (e) { resolve([]); }
    });
  });

  ipcMain.handle('get-session', async (_event, sessionId: string) => {
    return new Promise((resolve) => {
      try {
        const scriptPath = findScript('get_session.py');
        if (!scriptPath) { resolve([]); return; }
        const child = spawn(pythonExecutable, [scriptPath, sessionId], {
          shell: true, timeout: 5000, env: { ...process.env },
        });
        let stdout = '';
        child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr?.on('data', () => {});
        child.on('close', () => {
          try {
            const jsonMatch = stdout.match(/\[[\s\S]*\]/);
            if (jsonMatch) resolve(JSON.parse(jsonMatch[0]));
            else resolve([]);
          } catch (e) { resolve([]); }
        });
        child.on('error', () => resolve([]));
        setTimeout(() => { try { child.kill(); } catch {} resolve([]); }, 6000);
      } catch (e) { resolve([]); }
    });
  });

  // ── Stream control ──
  ipcMain.on('abort-stream', () => killActiveChild());
  ipcMain.on('send-input', (_e, input: string) => sendInputToChild(input));

  ipcMain.on('send-message', (_e, data) => {
    const win = getMainWindow();
    if (win) sendMessage(win, data);
  });

  // ── Window controls ──
    ipcMain.on('close-overlay', () => toggleVisibility());
    ipcMain.on('resize-overlay-content', (_e, height: number) => resizeWindowToContent(height));
    ipcMain.on('set-overlay-position', (_e, position: 'left' | 'right') => {
      if (position === 'left' || position === 'right') setOverlayHorizontalPosition(position);
    });
    ipcMain.on('open-terminal', () => {
      spawn('cmd.exe', ['/c', 'start powershell'], { detached: true, stdio: 'ignore' });
    });
    ipcMain.on('open-path', (_e, targetPath: string) => shell.openPath(targetPath));

    // Force reset window position (used by Ctrl+Shift+R and manual reset)
    ipcMain.on('set-bounds', (_e, x: number, y: number, width: number, height: number) => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;
      const clamped = clampToScreen(x, y, width, height);
      win.setResizable(true);
      win.setBounds({ x: clamped.x, y: clamped.y, width, height }, false);
      win.setResizable(false);
      saveOverlayConfig({ bounds: win.getBounds() });
    });

    ipcMain.on('set-small-window', (_e, enable: boolean) => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;

      const { workArea } = screen.getPrimaryDisplay();
      const newWidth = enable ? 380 : 420;
      const newHeight = enable ? 300 : 600;

      // Always anchor to bottom-right of work area for the NEW size
      // This prevents the window from flying off-screen when toggling modes
      const targetX = workArea.x + workArea.width - newWidth - 24;
      const targetY = workArea.y + workArea.height - newHeight - 24;

      // Hide → resize → show → force position (DWM workaround)
      win.hide();
      win.setResizable(true);
      win.setSize(newWidth, newHeight, false);
      win.setResizable(false);
      win.show();

      // Aggressive position enforcement at multiple intervals
      const enforce = () => {
        const b = win.getBounds();
        if (b.x !== targetX || b.y !== targetY) {
          win.setPosition(targetX, targetY, false);
        }
      };

      enforce();           // immediate
      setTimeout(enforce, 30);
      setTimeout(enforce, 100);
      setTimeout(enforce, 300);
      setTimeout(() => {
        enforce();
        saveOverlayConfig({ bounds: win.getBounds(), smallWindow: enable });
      }, 500);
    });

  // ── Settings ──
  ipcMain.on('set-launch-at-startup', (_e, enable: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enable, args: enable ? ['--hidden'] : [] });
    saveOverlayConfig({ launchAtStartup: enable });
  });

  ipcMain.on('set-always-on-top', (_e, enable: boolean) => {
    const win = getMainWindow();
    if (win) win.setAlwaysOnTop(enable);
    saveOverlayConfig({ bounds: { ...loadOverlayConfig().bounds, alwaysOnTop: enable } });
  });

  ipcMain.on('set-global-hotkey', (_e, hotkey: string) => {
    const config = loadOverlayConfig();
    const oldHotkey = config.triggerHotkey || 'Control+Space';
    try { globalShortcut.unregister(oldHotkey); } catch (e) {}
    try {
      if (!globalShortcut.register(hotkey, toggleVisibility)) {
        throw new Error(`Shortcut is already in use: ${hotkey}`);
      }
      saveOverlayConfig({ triggerHotkey: hotkey });
      updateAhkScript(hotkey);
    } catch (e) {
      console.error('Failed to register new hotkey', e);
      if (oldHotkey && globalShortcut.register(oldHotkey, toggleVisibility)) {
        saveOverlayConfig({ triggerHotkey: oldHotkey });
        updateAhkScript(oldHotkey);
      }
    }
  });

  // ── Context Capture (Screen & App Awareness) ──
  // Grabs screenshot + clipboard text in one shot — used for auto-context on summon.
  // Returns { screenshot?: {path, name}, clipboardText?: string }
  ipcMain.handle('capture-context', async () => {
    const win = getMainWindow();
    const wasVisible = Boolean(win && !win.isDestroyed() && win.isVisible());

    const result: { screenshot?: { path: string; name: string }; clipboardText?: string } = {};

    try {
      // Read clipboard text (instant, no UI disruption)
      try {
        const clipText = await clipboard.readText();
        if (clipText && clipText.trim().length > 0) {
          result.clipboardText = clipText.trim();
        }
      } catch (e) {
        // Clipboard read can fail in rare cases — not fatal
      }

      // Capture screenshot — hide overlay first if visible to avoid capturing ourselves
      if (wasVisible && win) {
        win.hide();
        await new Promise<void>((resolve) => setTimeout(resolve, 180));
      }

      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'], thumbnailSize: { width: 1920, height: 1080 },
        });
        if (sources.length > 0) {
          const tmpDir = path.join(os.tmpdir(), 'hermes-screenshots');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          const filename = `screenshot_${Date.now()}.png`;
          const filepath = path.join(tmpDir, filename);
          fs.writeFileSync(filepath, sources[0].thumbnail.toPNG());
          result.screenshot = { path: filepath, name: filename };
        }
      } catch (e) {
        console.error('[ContextCapture] Screenshot failed:', e);
      }
    } finally {
      if (wasVisible && win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    }

    return result;
  });

  // ── Files ──
  ipcMain.handle('capture-screenshot', async () => {
    const win = getMainWindow();
    const wasVisible = Boolean(win && !win.isDestroyed() && win.isVisible());

    try {
      if (wasVisible && win) {
        win.hide();
        await new Promise<void>((resolve) => setTimeout(resolve, 180));
      }

      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 1920, height: 1080 },
      });
      if (sources.length === 0) return null;
      const tmpDir = path.join(os.tmpdir(), 'hermes-screenshots');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const filename = `screenshot_${Date.now()}.png`;
      const filepath = path.join(tmpDir, filename);
      fs.writeFileSync(filepath, sources[0].thumbnail.toPNG());
      return { path: filepath, name: filename };
    } catch (e) {
      console.error('Screenshot capture failed:', e);
      return null;
    } finally {
      if (wasVisible && win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    }
  });

  ipcMain.handle('open-file-dialog', async () => {
    const result: any = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Supported', extensions: [
          'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
          'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'rtf',
          'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'toml', 'log',
          'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
          'cs', 'swift', 'kt', 'sh', 'ps1', 'bat', 'html', 'css', 'sql',
        ] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result?.canceled || result?.filePaths?.length === 0) return null;
    return result.filePaths.map((filepath: string) => ({ path: filepath, name: path.basename(filepath) }));
  });

  ipcMain.handle('read-dropped-file', async (_event, filePath: string) => {
    try {
      const stats = fs.statSync(filePath);
      const size = stats.size;
      const MAX_SIZE = 500 * 1024;
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'];
      const isImage = imageExts.includes(ext);

      if (size > MAX_SIZE) {
        return {
          name: path.basename(filePath), path: filePath, content: null, tooBig: true,
          size, ext, isImage,
        };
      }
      const textExts = [
        'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log',
        'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
        'cs', 'swift', 'kt', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
        'html', 'css', 'scss', 'less', 'sql', 'graphql',
      ];
      const content = textExts.includes(ext) ? fs.readFileSync(filePath, 'utf-8') : null;
      return {
        name: path.basename(filePath), path: filePath, content, tooBig: false,
        size, ext, isImage,
      };
    } catch (e: any) {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      return {
        name: path.basename(filePath), path: filePath, content: null, tooBig: false,
        size: 0, ext, isImage: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext),
        error: e.message,
      };
    }
  });

  ipcMain.handle('read-dir', async (_event, dirPath: string) => {
    try {
      const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const results = await Promise.all(items.map(async (item) => {
        let size = 0;
        try {
          if (!item.isDirectory()) {
            const stats = await fs.promises.stat(path.join(dirPath, item.name));
            size = stats.size;
          }
        } catch (e) {}
        return { name: item.name, isDir: item.isDirectory(), size };
      }));
      return results.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (e) { return []; }
  });

  // ── Echo Mode ──
  ipcMain.handle('transcribe-audio', async (_event, buffer: Uint8Array) => {
    const tmpPath = path.join(os.tmpdir(), `hermes_echo_${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, Buffer.from(buffer));
    try {
      // Use the persistent faster-whisper daemon; transcription is not a
      // supported one-shot option on the Hermes agent CLI.
      return await transcribeViaDaemon(tmpPath);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  });

  ipcMain.handle('synthesize-speech', async (event, { text, voice, provider, requestId, streamId, stream }) => {
    return new Promise((resolve, reject) => {
      const helperPath = findScript('hermes-echo-tts.py');
      if (!helperPath) {
        reject(new Error('Echo TTS helper is missing from the application.'));
        return;
      }
      const proc = spawn(pythonExecutable, stream ? [helperPath, '--stream'] : [helperPath], {
        cwd: path.join(hermesDir, 'hermes-agent'),
        env: { ...process.env, HERMES_HOME: hermesDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (requestId) {
        const processes = activeEchoTtsProcesses.get(requestId) ?? new Set<ChildProcess>();
        processes.add(proc);
        activeEchoTtsProcesses.set(requestId, processes);
      }
      const chunks: Buffer[] = [];
      let stderr = '';
      let receivedStreamBytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (requestId) {
          const processes = activeEchoTtsProcesses.get(requestId);
          processes?.delete(proc);
          if (processes?.size === 0) activeEchoTtsProcesses.delete(requestId);
        }
        if (stream && streamId && requestId && !event.sender.isDestroyed()) {
          event.sender.send('echo-tts-complete', {
            requestId,
            streamId,
            error: error?.message,
          });
        }
        if (error) reject(error);
        else resolve(stream ? true : Array.from(Buffer.concat(chunks)));
      };
      proc.stdout?.on('data', (d: Buffer) => {
        if (stream && streamId && requestId && !event.sender.isDestroyed()) {
          receivedStreamBytes += d.length;
          event.sender.send('echo-tts-audio', { requestId, streamId, chunk: Uint8Array.from(d) });
        } else chunks.push(d);
      });
      proc.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-3000); });
      proc.on('close', (code) => {
        if (code !== 0 || (stream ? receivedStreamBytes === 0 : chunks.length === 0)) finish(new Error(stderr.trim() || `Hermes TTS returned no audio (exit ${code ?? 'unknown'}).`));
        else finish();
      });
      proc.on('error', error => finish(new Error(`Could not start Hermes TTS: ${error.message}`)));
      proc.stdin?.end(JSON.stringify({ text, voice, provider, requestId, streamId }));
      const timeout = setTimeout(() => {
        proc.kill();
        finish(new Error('Hermes TTS timed out.'));
      }, 30_000);
    });
  });

  ipcMain.handle('echo-send-message', async (event, { text, imagePath, requestId, sessionId, freshText }) => {
    return new Promise((resolve, reject) => {
      const config = loadOverlayConfig();
      const queryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-echo-'));
      const queryPath = path.join(queryDir, 'query.txt');
      const args = ['chat'];
      const hermesSessionId = sessionId ? getMappedHermesSessionId(sessionId) : undefined;
      if (hermesSessionId) args.push('--resume', hermesSessionId);
      else {
        args.push('--source', 'cli');
        if (config.activeProvider) args.push('--provider', config.activeProvider);
        if (config.activeModel) args.push('--model', config.activeModel);
      }
      if (imagePath) args.push('--image', imagePath);
      args.push('-Q', '--format', 'stream-json', '--query-file', queryPath);
      const queryText = hermesSessionId && typeof freshText === 'string' ? freshText : text;
      fs.writeFileSync(queryPath, queryText, 'utf8');
      const childEnv: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb', HERMES_OVERLAY: '1' };
      delete childEnv.ELECTRON_RUN_AS_NODE;
      const overlayPythonHooks = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'hermes-overlay-python')
        : path.resolve(__dirname, '../../scripts/hermes-overlay-python');
      childEnv.PYTHONPATH = [overlayPythonHooks, childEnv.PYTHONPATH].filter(Boolean).join(path.delimiter);
      const proc = spawn(process.platform === 'win32' ? 'hermes.exe' : 'hermes', args, {
        cwd: os.homedir(),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      });
      if (requestId) activeEchoProcesses.set(requestId, proc);
      const parser = new HermesJsonlParser();
      const stderrParser = new HermesJsonlParser();
      let responseText = '';
      let stderr = '';
      let streamError = '';
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        try { fs.rmSync(queryDir, { recursive: true, force: true }); } catch { /* query cleanup */ }
        if (requestId && activeEchoProcesses.get(requestId) === proc) activeEchoProcesses.delete(requestId);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(responseText.trim());
      };
      const timeout = setTimeout(() => {
        proc.kill();
        finish(new Error('Hermes timed out before returning a response.'));
      }, 120_000);
      proc.stdout?.setEncoding('utf8');
      const publishEvents = (events: ReturnType<HermesJsonlParser['push']>) => {
        for (const item of events) {
          if (item.type === 'session') {
            if (sessionId) registerSessionMapping(sessionId, item.sessionId);
          } else if (item.type === 'error') {
            streamError = item.message;
          } else if (item.type === 'segment') {
            if (item.segment.type === 'text') {
              responseText += item.segment.content;
              if (!event.sender.isDestroyed() && requestId) {
                event.sender.send('echo-stream-chunk', { requestId, chunk: item.segment.content });
              }
            } else if (!event.sender.isDestroyed() && requestId) {
              event.sender.send('echo-stream-event', { requestId, event: item.segment });
            }
          }
        }
      };
      proc.stdout?.on('data', (chunk: string) => {
        publishEvents(parser.push(chunk));
      });
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (d: string) => {
        stderr = (stderr + d).slice(-6000);
        for (const item of stderrParser.push(d)) {
          if (item.type === 'session' && sessionId) registerSessionMapping(sessionId, item.sessionId);
        }
      });
      proc.on('close', (code) => {
        for (const item of stderrParser.finish()) {
          if (item.type === 'session' && sessionId) registerSessionMapping(sessionId, item.sessionId);
        }
        publishEvents(parser.finish());
        // stream-json carries the real failure in its terminal result event.
        // A failed gateway turn still writes Session/session_id to stderr, so
        // preferring stderr here hides the cause behind those metadata lines.
        if (streamError) {
          finish(new Error(streamError));
        } else if (code !== 0) {
          const details = stderr.split(/\r?\n/)
            .filter(line => !/^\s*(?:Session:|session_id:)/i.test(line))
            .join('\n')
            .trim()
            .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]');
          finish(new Error(details.slice(-1200) || `Hermes exited with code ${code ?? 'unknown'}.`));
        } else if (!responseText.trim()) {
          finish(new Error('Hermes returned an empty response. Check the selected provider and try again.'));
        } else finish();
      });
      proc.on('error', (error) => finish(new Error(`Could not start Hermes: ${error.message}`)));
    });
  });

  ipcMain.on('echo-cancel-message', (_event, requestId: string) => {
    const proc = activeEchoProcesses.get(requestId);
    if (proc && !proc.killed) proc.kill();
    activeEchoProcesses.delete(requestId);
    const ttsProcesses = activeEchoTtsProcesses.get(requestId);
    if (ttsProcesses) {
      for (const ttsProc of ttsProcesses) if (!ttsProc.killed) ttsProc.kill();
      activeEchoTtsProcesses.delete(requestId);
    }
  });

  ipcMain.on('trigger-echo-mode', () => {
    const win = getMainWindow();
    if (win) win.webContents.send('enter-echo-mode');
  });

  ipcMain.on('trigger-wake-word', () => {
    const win = getMainWindow();
    if (!win) return;
    if (!getIsVisible()) toggleVisibility();
    win.webContents.send('enter-echo-mode');
  });

  // ── Echo settings sync ──
  // Renderer calls these when echo settings change so the main process
  // can persist to overlay.json and restart services (clap detector, etc.)
  ipcMain.on('echo-settings-changed', (_e, settings: Record<string, any>) => {
    saveOverlayConfig(settings);
    // Restart clap detector if relevant settings changed
    if ('echoClapWakeEnabled' in settings || 'echoClapSensitivity' in settings) {
      const { restartClapDetector } = require('./clap-detector');
      restartClapDetector();
    }
  });

  // ── Clipboard ──
  ipcMain.handle('read-clipboard', () => {
    return clipboard.readText();
  });

  // ── Memory (MEMORY.md / USER.md) ──
  ipcMain.handle('read-memory', async () => {
    try {
      const hermesMemDir = path.join(hermesDir, 'memories');
      const result: Record<string, string> = {};

      // Read MEMORY.md
      const memoryPath = path.join(hermesMemDir, 'MEMORY.md');
      if (fs.existsSync(memoryPath)) {
        result.memory = fs.readFileSync(memoryPath, 'utf-8');
      }

      // Read USER.md
      const userPath = path.join(hermesMemDir, 'USER.md');
      if (fs.existsSync(userPath)) {
        result.user = fs.readFileSync(userPath, 'utf-8');
      }

      return result;
    } catch (e: any) {
      console.error('Failed to read memory files:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('save-memory', async (_event, data: { memory?: string; user?: string }) => {
    try {
      const hermesMemDir = path.join(hermesDir, 'memories');
      if (!fs.existsSync(hermesMemDir)) fs.mkdirSync(hermesMemDir, { recursive: true });

      if (data.memory !== undefined) {
        fs.writeFileSync(path.join(hermesMemDir, 'MEMORY.md'), data.memory, 'utf-8');
      }
      if (data.user !== undefined) {
        fs.writeFileSync(path.join(hermesMemDir, 'USER.md'), data.user, 'utf-8');
      }
      return { success: true };
    } catch (e: any) {
      console.error('Failed to save memory files:', e);
      return { error: e.message };
    }
  });

  // ── Session Search ──
  ipcMain.handle('search-sessions', async (_event, query: string) => {
    return new Promise((resolve) => {
      try {
        const scriptPath = findScript('search_sessions.py');
        if (!scriptPath) { resolve([]); return; }
        const child = spawn(pythonExecutable, [scriptPath, query], {
          shell: true, timeout: 5000, env: { ...process.env },
        });
        let stdout = '';
        child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr?.on('data', () => {});
        child.on('close', () => {
          try {
            const jsonMatch = stdout.match(/\[[\s\S]*\]/);
            if (jsonMatch) resolve(JSON.parse(jsonMatch[0]));
            else resolve([]);
          } catch (e) { resolve([]); }
        });
        child.on('error', () => resolve([]));
        setTimeout(() => { try { child.kill(); } catch {} resolve([]); }, 6000);
      } catch (e) { resolve([]); }
    });
  });

  // ── Background Tasks (Fire-and-Forget Agents) ──
  ipcMain.handle('dispatch-background', async (_event, data: {
    text: string;
    sessionId?: string;
    provider?: string;
    model?: string;
  }) => {
    const taskId = `bg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const config = loadOverlayConfig();

    const args: string[] = [];
    if (data.sessionId) args.push('--resume', data.sessionId);
    args.push('chat', '-q', data.text, '--accept-hooks');
    const provider = data.provider || config.activeProvider;
    const model = data.model || config.activeModel;
    if (provider) args.push('--provider', provider);
    if (model) args.push('--model', model);

    const task: BackgroundTask = {
      id: taskId,
      prompt: data.text.substring(0, 100),
      status: 'running',
      output: '',
      startTime: Date.now(),
    };
    backgroundTasks.set(taskId, task);

    // Notify renderer that a task started
    const win = getMainWindow();
    win?.webContents.send('background-task-update', { ...task });

    try {
      const isWindows = process.platform === 'win32';
      const child = spawn(isWindows ? 'hermes.exe' : 'hermes', args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          TERM: 'dumb',
        },
      });

      let output = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        output += text;

        // Capture session ID
        if (!task.hermesSessionId) {
          const match = output.match(/Session:\s+([a-zA-Z0-9_]+)/);
          if (match) task.hermesSessionId = match[1];
        }
      });
      child.stderr?.on('data', () => {});

      child.on('close', (code) => {
        task.status = code === 0 ? 'completed' : 'failed';
        task.endTime = Date.now();
        task.output = output.substring(0, 50000); // Cap output

        // Send Windows native notification
        try {
          if (Notification.isSupported()) {
            const notif = new Notification({
              title: 'Hermes Background Task',
              body: task.status === 'completed'
                ? `Task complete: "${task.prompt}..."`
                : `Task failed: "${task.prompt}..."`,
              silent: false,
            });
            notif.on('click', () => {
              // Show the overlay when notification is clicked
              const w = getMainWindow();
              if (w && !getIsVisible()) {
                toggleVisibility();
              }
              w?.webContents.send('background-task-clicked', taskId);
            });
            notif.show();
          }
        } catch (e) {
          console.error('[BackgroundTask] Notification failed:', e);
        }

        // Notify renderer
        const w = getMainWindow();
        w?.webContents.send('background-task-update', { ...task });
      });

      child.on('error', (err) => {
        task.status = 'failed';
        task.endTime = Date.now();
        task.output = `Error: ${err.message}`;
        backgroundTasks.set(taskId, { ...task });
        const w = getMainWindow();
        w?.webContents.send('background-task-update', { ...task });
      });
    } catch (err: any) {
      task.status = 'failed';
      task.output = `Error: ${err.message}`;
      backgroundTasks.set(taskId, { ...task });
      const w = getMainWindow();
      w?.webContents.send('background-task-update', { ...task });
    }

    return taskId;
  });

  ipcMain.handle('list-background-tasks', async () => {
    return Array.from(backgroundTasks.values()).sort((a, b) => b.startTime - a.startTime);
  });

  ipcMain.handle('get-background-task', async (_event, taskId: string) => {
    return backgroundTasks.get(taskId) || null;
  });

  ipcMain.handle('clear-background-task', async (_event, taskId: string) => {
    backgroundTasks.delete(taskId);
    return true;
  });

  // ── Quick Actions (Floating Toolbar) ──
  const { processQuickAction, hideQuickActions } = require('./quick-actions');

  ipcMain.handle('quick-action-execute', async (_event, data: { action: string; text: string }) => {
    return processQuickAction(data.action, data.text);
  });

  ipcMain.on('quick-action-close', () => {
    hideQuickActions();
  });
}
