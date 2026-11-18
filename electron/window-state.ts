import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface WindowState { bounds: Rectangle; maximized: boolean; fullscreen: boolean }
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

export function restoreWindowState() {
  const primary = screen.getPrimaryDisplay().workArea;
  let state: WindowState = {
    bounds: { width: Math.min(1440, primary.width), height: Math.min(940, primary.height),
      x: primary.x + Math.round((primary.width - Math.min(1440, primary.width)) / 2),
      y: primary.y + Math.round((primary.height - Math.min(940, primary.height)) / 2) },
    maximized: false, fullscreen: false
  };
  try {
    const saved = JSON.parse(readFileSync(stateFile(), 'utf8'));
    const b = saved?.bounds;
    if (saved.version === 1 && b && ['x', 'y', 'width', 'height'].every(k => Number.isInteger(b[k]) && Math.abs(b[k]) < 1000000)
      && b.width > 0 && b.height > 0 && typeof saved.maximized === 'boolean' && typeof saved.fullscreen === 'boolean') {
      state = { bounds: b, maximized: saved.maximized, fullscreen: saved.fullscreen };
    }
  } catch { /* First launch or an unreadable state file uses the defaults. */ }
  // Reconnect safely when a monitor was removed or its resolution changed.
  const area = screen.getDisplayMatching(state.bounds).workArea;
  const minWidth = Math.min(900, area.width), minHeight = Math.min(620, area.height);
  const width = Math.min(area.width, Math.max(minWidth, state.bounds.width));
  const height = Math.min(area.height, Math.max(minHeight, state.bounds.height));
  state.bounds = { width, height,
    x: Math.max(area.x, Math.min(state.bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(state.bounds.y, area.y + area.height - height)) };
  return { ...state, minWidth, minHeight };
}

export function rememberWindowState(win: BrowserWindow, initial: WindowState) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let maximized = initial.maximized, fullscreen = initial.fullscreen;
  function save() {
    if (win.isDestroyed()) return;
    try {
      const file = stateFile(), temp = `${file}.tmp`;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(temp, JSON.stringify({ version: 1, bounds: win.getNormalBounds(), maximized, fullscreen }), 'utf8');
      renameSync(temp, file);
    } catch { /* A settings write failure must not block closing the app. */ }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(save, 250); }
  win.on('move', schedule);
  win.on('resize', schedule);
  win.on('maximize', () => { maximized = true; schedule(); });
  win.on('unmaximize', () => { maximized = false; schedule(); });
  win.on('enter-full-screen', () => { fullscreen = true; schedule(); });
  win.on('leave-full-screen', () => { fullscreen = false; schedule(); });
  win.on('close', () => { clearTimeout(timer); save(); });
  win.on('closed', () => clearTimeout(timer));
}
