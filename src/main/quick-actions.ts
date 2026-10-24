/**
 * Quick Actions — Mini floating toolbar for inline text transformations.
 *
 * Flow:
 * 1. User presses Ctrl+Shift+A (registered in main.ts)
 * 2. AHK simulates Ctrl+C to copy selected text from the active window
 * 3. This module shows a tiny BrowserWindow at cursor position
 * 4. User clicks [Rewrite] / [Summarize] / [Explain]
 * 5. We send the selected text + action to hermes.exe
 * 6. Result is written to clipboard and Ctrl+V is simulated to paste it back
 */

import { BrowserWindow, screen, clipboard, globalShortcut } from 'electron';
import path from 'path';
import { spawn, exec } from 'child_process';
import { loadOverlayConfig } from './config';
import { getMainWindow } from './window';

let quickWindow: BrowserWindow | null = null;

export function createQuickActionsWindow(): BrowserWindow {
  if (quickWindow && !quickWindow.isDestroyed()) {
    return quickWindow;
  }

  quickWindow = new BrowserWindow({
    width: 220,
    height: 44,
    frame: false,
    transparent: true,
    hasShadow: true,
    thickFrame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the quick-actions HTML page
  if (process.env.VITE_DEV_SERVER_URL) {
    quickWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '#quick-actions');
  } else {
    quickWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'quick-actions' });
  }

  quickWindow.on('blur', () => {
    // Auto-hide when user clicks away
    if (quickWindow && !quickWindow.isDestroyed()) {
      quickWindow.hide();
    }
  });

  return quickWindow;
}

export function showQuickActionsAtCursor() {
  const win = createQuickActionsWindow();

  // Get cursor position
  const cursorPos = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPos);

  // Position the toolbar near the cursor, but keep it on screen
  const width = 220;
  const height = 44;
  let x = cursorPos.x - width / 2;
  let y = cursorPos.y - height - 12; // 12px above cursor

  // Clamp to display bounds
  const workArea = display.workArea;
  x = Math.max(workArea.x + 4, Math.min(x, workArea.x + workArea.width - width - 4));
  y = Math.max(workArea.y + 4, Math.min(y, workArea.y + workArea.height - height - 4));

  win.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  win.show();
  win.focus();
}

export function hideQuickActions() {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.hide();
  }
}

/**
 * Process a quick action: send selected text to Hermes, get result, paste back.
 * Called from the renderer via IPC.
 */
export function processQuickAction(action: string, selectedText: string): Promise<string> {
  return new Promise((resolve) => {
    const config = loadOverlayConfig();

    const prompts: Record<string, string> = {
      rewrite: `Rewrite the following text, keeping the same meaning but improving clarity, flow, and style. Return ONLY the rewritten text, no explanations:\n\n${selectedText}`,
      summarize: `Summarize the following text in 2-3 sentences. Return ONLY the summary, no preamble:\n\n${selectedText}`,
      explain: `Explain the following text in simple, clear terms. Return ONLY the explanation:\n\n${selectedText}`,
    };

    const prompt = prompts[action] || prompts.rewrite;
    const args = ['chat', '-q', prompt, '--accept-hooks', '-t', ''];

    const provider = config.activeProvider;
    const model = config.activeModel;
    if (provider) args.push('--provider', provider);
    if (model) args.push('--model', model);

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
    });
    child.stderr?.on('data', () => {});

    child.on('close', () => {
      // Parse the output — strip metadata lines like the main parser
      const lines = output.split('\n');
      const contentLines: string[] = [];
      let inContent = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith('Query:') ||
          trimmed.startsWith('Initializing agent') ||
          trimmed.match(/^─+$/) ||
          trimmed.startsWith('Resume this session with:') ||
          trimmed.startsWith('hermes --resume') ||
          trimmed.startsWith('Session:') ||
          trimmed.startsWith('Duration:') ||
          trimmed.startsWith('Messages:') ||
          trimmed.startsWith('Exit code:') ||
          trimmed.startsWith('↻') ||
          trimmed.match(/Resumed session/) ||
          trimmed.startsWith('╭─') ||
          trimmed.startsWith('╰─') ||
          trimmed.match(/^[│┊]\s/)
        ) {
          continue;
        }
        if (trimmed) {
          inContent = true;
          contentLines.push(line.replace(/^    /gm, ''));
        }
      }

      const result = contentLines.join('\n').trim();

      // Write result to clipboard
      if (result) {
        clipboard.writeText(result);

        // Simulate Ctrl+V to paste — but only if the main overlay is NOT focused
        // (otherwise we'd paste into the overlay instead of the original app)
        const mainWindow = getMainWindow();
        const isOverlayFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
        if (!isOverlayFocused) {
          // Use PowerShell to send Ctrl+V — safer than external AHK dependency
          if (process.platform === 'win32') {
            exec('powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"', () => {});
          }
        }
      }

      resolve(result || '(no output)');
    });

    child.on('error', (err) => {
      resolve(`Error: ${err.message}`);
    });

    // 30 second timeout
    setTimeout(() => { child.kill(); resolve('Timeout'); }, 30000);
  });
}

/**
 * Simulate Ctrl+C to copy currently selected text from the active window.
 * Returns the clipboard text after a small delay.
 */
export async function captureSelectedText(): Promise<string> {
    // Save current clipboard to restore later if no text is selected
    const previousClipboard = await clipboard.readText();

    if (process.platform === 'win32') {
      return new Promise((resolve) => exec('powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^c\')"', () => {
        // Small delay for clipboard to populate
        setTimeout(async () => {
          const text = await clipboard.readText();
          // If clipboard didn't change, no text was selected — restore previous
          if (text === previousClipboard) {
            resolve('');
          } else {
            // Restore previous clipboard
            await clipboard.writeText(previousClipboard);
            resolve(text);
          }
        }, 100);
      }));
    } else {
      return clipboard.readText();
    }
}

export function registerQuickActionsHotkey() {
  try {
    globalShortcut.register('Control+Shift+A', async () => {
      // Capture selected text first
      const selectedText = await captureSelectedText();
      if (!selectedText.trim()) return; // No text selected, don't show toolbar

      // Store the selected text for the quick-actions window to use
      const win = createQuickActionsWindow();
      win.webContents.send('quick-action-text', selectedText);
      showQuickActionsAtCursor();
    });
    console.log('✓ Registered Quick Actions hotkey: Ctrl+Shift+A');
  } catch (e) {
    console.error('Failed to register Quick Actions hotkey:', e);
  }
}

export function unregisterQuickActionsHotkey() {
  try { globalShortcut.unregister('Control+Shift+A'); } catch (e) {}
}
