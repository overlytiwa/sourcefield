import { spawn } from 'node:child_process';
import { createServer } from 'vite';
await import('./build-electron.mjs');
const server = await createServer();
await server.listen();
const { default: electron } = await import('electron');
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, SOURCEFIELD_DEV: '1' } });
let closing = false;
async function close(code = 0) { if (closing) return; closing = true; child.kill(); await server.close(); process.exit(code); }
child.on('exit', code => close(code ?? 0));
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
