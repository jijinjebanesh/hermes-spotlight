/**
 * Hotkey Server — HTTP toggle server for AHK communication.
 * Listens on localhost:34567 for /toggle and /show endpoints.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { toggleVisibility, getMainWindow, getIsVisible } from './window';

let server: http.Server | null = null;
let authToken: string = '';

export function startHotkeyServer() {
  // Generate token and write to disk for scripts to read
  authToken = crypto.randomBytes(32).toString('hex');
  const tokenPath = path.join(app.getPath('userData'), '.hotkey-token');
  try {
    fs.writeFileSync(tokenPath, authToken, { mode: 0o600 });
  } catch (err) {
    console.error('Failed to write hotkey token:', err);
  }

  server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      
      // Verify token
      const authHeader = req.headers.authorization || '';
      const queryToken = url.searchParams.get('token');
      if (authHeader !== `Bearer ${authToken}` && queryToken !== authToken) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }

      if (url.pathname === '/toggle' && req.method === 'POST') {
        toggleVisibility();
        res.writeHead(200);
        res.end('OK');
      } else if (url.pathname === '/show' && req.method === 'POST') {
        if (!getIsVisible() && getMainWindow() && !getMainWindow()!.isDestroyed()) {
          toggleVisibility();
        }
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    } catch (e) {
      res.writeHead(400);
      res.end('Bad Request');
    }
  });

  server.listen(34567, '127.0.0.1', () => {
    console.log('✓ Toggle server listening on port 34567');
  });
}

export function stopHotkeyServer() {
  if (server) {
    server.close();
    server = null;
  }
}
