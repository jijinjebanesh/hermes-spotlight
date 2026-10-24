/**
 * Config — Overlay configuration persistence.
 * Keeps Spotlight preferences separate while reading Hermes data from its
 * configured home directory.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
export const hermesDir = process.env.HERMES_HOME || path.join(localAppData, 'hermes');
const appConfigDir = path.join(process.env.APPDATA || os.homedir(), 'Hermes Spotlight');
export const overlayConfigPath = path.join(appConfigDir, 'config.json');
export const sessionsDir = path.join(hermesDir, 'sessions');

// Hermes CLI config location
export const hermesCliConfigPath = path.join(hermesDir, 'config.yaml');

// Ensure directories exist
if (!fs.existsSync(hermesDir)) fs.mkdirSync(hermesDir, { recursive: true });
if (!fs.existsSync(appConfigDir)) fs.mkdirSync(appConfigDir, { recursive: true });
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

export function loadOverlayConfig(): Record<string, any> {
  try {
    if (fs.existsSync(overlayConfigPath)) {
      return JSON.parse(fs.readFileSync(overlayConfigPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load overlay config', e);
  }
  return {};
}

export function saveOverlayConfig(data: Record<string, any>) {
  try {
    const existing = loadOverlayConfig();
    fs.writeFileSync(
      overlayConfigPath,
      JSON.stringify({ ...existing, ...data }, null, 2)
    );
  } catch (e) {
    console.error('Failed to save overlay config', e);
  }
}

// Update Hermes CLI's nested model defaults without turning its `model` map
// into a scalar (which makes config.yaml invalid and causes Hermes to ignore it).
export function setHermesModel(provider: string, model: string): { success: boolean; error?: string } {
  try {
    if (!fs.existsSync(hermesCliConfigPath)) {
      return { success: false, error: `Config not found: ${hermesCliConfigPath}` };
    }

    const config = fs.readFileSync(hermesCliConfigPath, 'utf8');
    const newline = config.includes('\r\n') ? '\r\n' : '\n';
    const lines = config.split(/\r?\n/);
    let modelIndex = lines.findIndex((line) => /^model\s*:/.test(line));

    if (modelIndex < 0) {
      lines.unshift('model:');
      modelIndex = 0;
    } else if (/^model\s*:\s*\S/.test(lines[modelIndex])) {
      // Migrate a legacy scalar value to Hermes' current model mapping.
      lines[modelIndex] = 'model:';
    }

    let modelEnd = modelIndex + 1;
    while (modelEnd < lines.length && (/^\s/.test(lines[modelEnd]) || !lines[modelEnd].trim())) {
      modelEnd++;
    }

    const modelValue = JSON.stringify(model);
    const providerValue = JSON.stringify(provider);
    let defaultIndex = -1;
    let providerIndex = -1;
    for (let i = modelIndex + 1; i < modelEnd; i++) {
      if (/^\s+default\s*:/.test(lines[i])) defaultIndex = i;
      if (/^\s+provider\s*:/.test(lines[i])) providerIndex = i;
    }

    if (defaultIndex >= 0) lines[defaultIndex] = `  default: ${modelValue}`;
    else lines.splice(modelIndex + 1, 0, `  default: ${modelValue}`);

    // Recompute the section after a possible insertion and keep the provider in
    // sync with the model selected in Spotlight.
    modelEnd = modelIndex + 1;
    while (modelEnd < lines.length && (/^\s/.test(lines[modelEnd]) || !lines[modelEnd].trim())) {
      modelEnd++;
    }
    providerIndex = -1;
    for (let i = modelIndex + 1; i < modelEnd; i++) {
      if (/^\s+provider\s*:/.test(lines[i])) providerIndex = i;
    }
    if (providerIndex >= 0) lines[providerIndex] = `  provider: ${providerValue}`;
    else lines.splice(modelEnd, 0, `  provider: ${providerValue}`);

    fs.writeFileSync(hermesCliConfigPath, lines.join(newline), 'utf8');
    return { success: true };
  } catch (e) {
    console.error('Failed to update Hermes CLI config', e);
    return { success: false, error: String(e) };
  }
}
