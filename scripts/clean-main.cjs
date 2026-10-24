const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const outputPath = path.resolve(workspaceRoot, 'dist-electron');
if (path.relative(workspaceRoot, outputPath) !== 'dist-electron') {
  throw new Error(`Refusing to clean an unexpected build directory: ${outputPath}`);
}
fs.rmSync(outputPath, { recursive: true, force: true });
