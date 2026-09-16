#!/usr/bin/env node
// Reads .env and launches `expo start` with EXPO_DEV_PORT applied.
// Usage: node scripts/start-dev.js [--web|--ios|--android ...extra expo args]
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const port = process.env.EXPO_DEV_PORT || '8081';
const args = ['expo', 'start', '--port', port, ...process.argv.slice(2)];

const child = spawn('npx', args, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
