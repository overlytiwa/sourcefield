#!/usr/bin/env node
// npm link exposes this launcher as `sourcefield` on macOS, Windows, and Linux.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'mcp') {
  const entry = path.resolve(__dirname, '../dist-electron/mcp.cjs');
  if (!fs.existsSync(entry)) { console.error('Build Sourcefield first with npm run build.'); process.exit(1); }
  require(entry).startMcpServer().catch(error => { console.error('Sourcefield MCP: ' + error.message); process.exitCode = 1; });
} else {
if (args.includes('--help') || args.includes('-h')) {
  console.log('Sourcefield\n\nUsage: sourcefield [directory | map.sourcefield]\n\n  sourcefield .      Open and visualize the current directory\n  sourcefield        Open the desktop app\n  sourcefield mcp    Start the local MCP stdio server\n');
  process.exit(0);
}
if (args.includes('--version')) { console.log(require('../package.json').version); process.exit(0); }
const appPath = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(appPath, 'dist-electron/main.cjs'))) {
  console.error('Sourcefield is not built yet. Run npm run build in ' + appPath); process.exit(1);
}
let targetArgs = [];
if (args[0]) {
  const target = path.resolve(process.cwd(), args[0]);
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) targetArgs = ['--project', target];
    else if (target.toLowerCase().endsWith('.sourcefield')) targetArgs = ['--map', target];
    else throw new Error('Choose a directory or a .sourcefield file.');
  } catch (error) { console.error('Sourcefield: ' + error.message); process.exit(1); }
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [appPath, ...targetArgs], { cwd: process.cwd(), detached: true, stdio: 'ignore', env });
child.on('error', error => { console.error('Unable to start Sourcefield: ' + error.message); process.exitCode = 1; });
child.unref();

}
