import { app, BrowserWindow, dialog, ipcMain, Menu, clipboard } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { launchTarget } from './launch-target';
import { ProjectQuery } from './mcp/query';
import { startLocalBridge } from './mcp/bridge';
import type { RemoteViewCommand, RemoteViewResult, McpConfiguration } from '../shared/types';
import { Worker } from 'node:worker_threads';
import type { ActionResult, CodeMap, ScanOptions } from '../shared/types';
import { readMap, validateView, writeMap } from './format';
import { rememberWindowState, restoreWindowState } from './window-state';

let window: BrowserWindow | null = null, activeMap: CodeMap | null = null, scanWorker: Worker | null = null;
let pendingFile: string | undefined, pendingProject: string | undefined;
let rendererReady = false;
let activeRoot: string | null = null;
let scanOptions: ScanOptions = { includeDependencies: false };
function loadScanOptions() {
  try { const value = JSON.parse(readFileSync(path.join(app.getPath('userData'), 'scan-settings.json'), 'utf8')); if (typeof value.includeDependencies === 'boolean') scanOptions = { includeDependencies: value.includeDependencies }; } catch { /* Default to project code. */ }
}
function rememberScanOptions(options: ScanOptions) {
  scanOptions = options;
  try { const directory = app.getPath('userData'); mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'scan-settings.json'), JSON.stringify(options), { mode: 0o600 }); }
  catch (error) { console.error('Unable to remember scan settings:', error); }
}
let openGeneration = 0;
class SupersededOpen extends Error {};
let projectQuery: ProjectQuery | null = null;
let localBridge: Awaited<ReturnType<typeof startLocalBridge>> | null = null;
const pendingViews = new Map<string, { resolve: (v: RemoteViewResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; projectId: string }>();
function activateMap(map: CodeMap, root: string | null) { activeMap = map; activeRoot = root; projectQuery = new ProjectQuery(map, root); }
let startupTask: Promise<ActionResult<CodeMap | null>> | null = null;
const failure = (error: unknown): ActionResult<never> => ({ ok: false, error: error instanceof Error ? error.message : 'Something went wrong.', ...(error instanceof SupersededOpen ? { cancelled: true } : {}) });
const cancel = (): ActionResult<never> => ({ ok: false, error: 'Cancelled', cancelled: true });
const command = (value: string) => window?.webContents.send('sourcefield:command', value);
const trusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted application request.');
};
async function importFile(file: string) {
  if (scanWorker) throw new Error('Finish or cancel the current scan first.');
  const generation = ++openGeneration;
  const value = await readMap(file);
  if (generation !== openGeneration) throw new SupersededOpen('A newer project or map was opened.');
  activateMap(value, null);
  return value;
}
function createWindow() {
  rendererReady = false;
  const state = restoreWindowState();
  const iconDirectory = app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(app.getAppPath(), 'resources', 'icons');
  const icon = path.join(iconDirectory, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  if (process.platform === 'win32') app.setAppUserModelId('app.sourcefield.desktop');
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(iconDirectory, 'icon.png'));
  window = new BrowserWindow({ ...state.bounds, minWidth: state.minWidth, minHeight: state.minHeight, backgroundColor: '#000000', show: false,
    title: 'Sourcefield', autoHideMenuBar: true, icon,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  const win = window;
  rememberWindowState(win, state);
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    if (state.fullscreen) win.setFullScreen(true);
    win.show();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('closed', () => { rendererReady = false; for (const [id, pending] of pendingViews) { clearTimeout(pending.timer); pending.reject(new Error('The Sourcefield window closed.')); pendingViews.delete(id); } scanWorker?.terminate(); scanWorker = null; window = null; });

  if (process.env.SOURCEFIELD_DEV === '1' && !app.isPackaged) window.loadURL('http://127.0.0.1:5173');
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: 'Sourcefield', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] } as Electron.MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      { label: 'Open project folder…', accelerator: 'CmdOrCtrl+O', click: () => command('open-folder') },
      { label: 'Open map…', accelerator: 'CmdOrCtrl+Shift+O', click: () => command('open-map') },
      { label: 'Export map…', accelerator: 'CmdOrCtrl+E', click: () => command('export') },
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Find symbol', accelerator: 'CmdOrCtrl+F', click: () => command('search') },
      { label: 'Fit map', accelerator: 'Shift+F', click: () => command('fit') },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' } as Electron.MenuItemConstructorOptions] : [])
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function runScan(root: string, options: ScanOptions = scanOptions) {
  const generation = ++openGeneration;
  return new Promise<ActionResult<CodeMap>>(resolve => {
    let settled = false;
    const worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { root, options } });
    scanWorker = worker;
    function finish(result: ActionResult<CodeMap>) {
      if (settled) return; settled = true;
      if (scanWorker === worker) scanWorker = null;
      worker.terminate(); resolve(result);
    }
    worker.on('message', message => {
      if (message.type === 'progress' && generation === openGeneration) window?.webContents.send('sourcefield:progress', message.value);
      if (message.type === 'complete') { if (generation !== openGeneration) { finish(cancel()); return; } activateMap(message.value, path.resolve(root)); finish({ ok: true, value: message.value }); }
      if (message.type === 'error') finish(failure(new Error(message.error)));
    });
    worker.on('error', error => finish(failure(error)));
    worker.on('exit', code => { if (!settled) finish(scanWorker !== worker || code === 0 ? cancel() : failure(new Error('The scan stopped. Try a smaller project.'))); });
  });
}
function requestRemoteView(command: RemoteViewCommand, projectId: string) {
  return new Promise<RemoteViewResult>((resolve, reject) => {
    if (!window || !rendererReady || projectQuery?.id !== projectId) { reject(new Error('The current desktop visualization is not ready.')); return; }
    const id = randomUUID();
    const timer = setTimeout(() => { pendingViews.delete(id); reject(new Error('The visualization did not acknowledge the command.')); }, 6000);
    pendingViews.set(id, { resolve, reject, timer, projectId });
    window.webContents.send('sourcefield:remote-view', { id, command });
  });
}
ipcMain.on('sourcefield:view-result', (event, reply: unknown) => {
  try { trusted(event); } catch { return; }
  if (!reply || typeof reply !== 'object' || !('id' in reply) || typeof reply.id !== 'string') return;
  const pending = pendingViews.get(reply.id); if (!pending) return;
  pendingViews.delete(reply.id); clearTimeout(pending.timer);
  try {
    if (projectQuery?.id !== pending.projectId) throw new Error('The active project changed. Search again.');
    const data = reply as { ok?: boolean; value?: RemoteViewResult; error?: string };
    if (!data.ok || !data.value) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 500) : 'View command failed.');
    const ids = new Set(activeMap!.nodes.map(n => n.id));
    const view = validateView(data.value.view, ids);
    const highlighted = data.value.highlighted_node_ids;
    if (!Array.isArray(highlighted) || highlighted.length > 100 || highlighted.some(id => !ids.has(id))) throw new Error('Invalid view result.');
    pending.resolve({ view, highlighted_node_ids: highlighted });
  } catch (error) { pending.reject(error as Error); }
});
function mcpConfiguration(): McpConfiguration {
  const entry = app.isPackaged ? path.join(process.resourcesPath, 'mcp', 'sourcefield-mcp.cjs') : path.join(app.getAppPath(), 'dist-electron', 'mcp.cjs');
  const command = process.env.SOURCEFIELD_NODE_PATH || 'node', args = [entry];
  return { running: !!localBridge, transport: 'stdio', command, args,
    claude: JSON.stringify({ mcpServers: { sourcefield: { command, args } } }, null, 2),
    codex: '[mcp_servers.sourcefield]\ncommand = ' + JSON.stringify(command) + '\nargs = [' + args.map(arg => JSON.stringify(arg)).join(', ') + ']\n' };
}
ipcMain.handle('sourcefield:mcp-config', event => { trusted(event); return mcpConfiguration(); });
ipcMain.handle('sourcefield:mcp-copy', (event, client: unknown) => { trusted(event); if (client !== 'claude' && client !== 'codex') throw new Error('Unknown client.'); clipboard.writeText(mcpConfiguration()[client]); });
ipcMain.handle('sourcefield:ready', async event => {
  trusted(event); rendererReady = true;
  if (startupTask) return startupTask;
  if (pendingProject || pendingFile) {
    const project = pendingProject, file = pendingFile; pendingProject = undefined; pendingFile = undefined;
    startupTask = (async (): Promise<ActionResult<CodeMap | null>> => {
      try { return project ? await runScan(project) : { ok: true, value: await importFile(file!) }; } catch (error) { return failure(error); }
    })();
    const result = await startupTask; startupTask = null; return result;
  }
  return { ok: true, value: activeMap };
});
ipcMain.handle('sourcefield:folder', async event => {
  trusted(event); if (!window) return cancel();
  if (scanWorker) return failure(new Error('A scan is already running.'));
  const selected = await dialog.showOpenDialog(window, { title: 'Open codebase', properties: ['openDirectory'] });
  if (selected.canceled || !selected.filePaths[0]) return cancel();
  return runScan(selected.filePaths[0]);
});
ipcMain.handle('sourcefield:cancel', async event => { trusted(event); ++openGeneration; const worker = scanWorker; scanWorker = null; if (worker) await worker.terminate(); });
ipcMain.handle('sourcefield:scan-state', event => {
  trusted(event); return { includeDependencies: activeMap ? activeMap.scan?.includeDependencies ?? false : scanOptions.includeDependencies, canRescan: !!activeRoot };
});
ipcMain.handle('sourcefield:dependencies', async (event, include: unknown) => {
  trusted(event);
  if (typeof include !== 'boolean') return failure(new Error('Invalid dependency setting.'));
  if (scanWorker) return failure(new Error('Finish or cancel the current scan first.'));
  if (!activeRoot) return failure(new Error('Open the project folder to change which code is scanned. Saved maps only contain their exported nodes.'));
  try {
    const options = { includeDependencies: include };
    const result = await runScan(activeRoot, options);
    // A failed, cancelled or superseded scan must not change the saved preference.
    if (result.ok && activeMap === result.value) rememberScanOptions(options);
    return result;
  } catch (error) { return failure(error); }
});
ipcMain.handle('sourcefield:open', async event => {
  trusted(event); if (!window) return cancel();
  try {
    if (scanWorker) throw new Error('Finish or cancel the current scan first.');
    const result = await dialog.showOpenDialog(window, { title: 'Open Sourcefield map', properties: ['openFile'], filters: [{ name: 'Sourcefield map', extensions: ['sourcefield'] }] });
    if (result.canceled || !result.filePaths[0]) return cancel();
    return { ok: true, value: await importFile(result.filePaths[0]) };
  } catch (error) { return failure(error); }
});
ipcMain.handle('sourcefield:export', async (event, savedView: unknown) => {
  trusted(event); if (!window || !activeMap) return failure(new Error('Open a project or map first.'));
  try {
    const map = activeMap, view = validateView(savedView, new Set(map.nodes.map(n => n.id)));
    const result = await dialog.showSaveDialog(window, { title: 'Export Sourcefield map', defaultPath: `${map.project.name.replace(/[<>:"/\\|?*]/g, '-')}.sourcefield`,
      filters: [{ name: 'Sourcefield map', extensions: ['sourcefield'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (result.canceled || !result.filePath) return cancel();
    const file = result.filePath.toLowerCase().endsWith('.sourcefield') ? result.filePath : `${result.filePath}.sourcefield`;
    await writeMap(file, { ...map, view });
    return { ok: true, value: { name: path.basename(file) } };
  } catch (error) { return failure(error); }
});
async function openExternalTarget(target: { file?: string; project?: string }) {
  if (!window || !rendererReady) { pendingFile = target.file; pendingProject = target.project; return; }
  if (!target.file && !target.project) return;
  const worker = scanWorker; scanWorker = null;
  if (worker) await worker.terminate();
  try {
    if (target.file) window?.webContents.send('sourcefield:map', await importFile(target.file));
    else if (target.project) { const result = await runScan(target.project); if (result.ok) window?.webContents.send('sourcefield:map', result.value); else if (!result.cancelled) dialog.showErrorBox('Unable to scan project', result.error); }
  } catch (e) { if (!(e instanceof SupersededOpen)) dialog.showErrorBox('Unable to open project', (e as Error).message); }
}
app.on('open-file', (event, file) => { event.preventDefault(); void openExternalTarget({ file }); });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (window?.isMinimized()) window.restore();
    window?.show(); window?.focus();
    void openExternalTarget(launchTarget(argv, workingDirectory, app.isPackaged));
  });
  app.whenReady().then(async () => {
    loadScanOptions();
    try {
      localBridge = await startLocalBridge(async (name, args) => {
        const project = projectQuery;
        if (!project) throw new Error('Choose a project or saved map in Sourcefield first.');
        if (scanWorker) throw new Error('Sourcefield is scanning. Wait for the scan to finish.');
        const result = await project.execute(name, args, command => requestRemoteView(command, project.id));
        if (projectQuery !== project) throw new Error('The active project changed. Search again.');
        return result;
      });
    } catch (error) { console.error('Sourcefield local MCP bridge could not start:', (error as Error).message); }
    const target = launchTarget(process.argv, process.cwd(), app.isPackaged); pendingFile ??= target.file; pendingProject = target.project; createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
  app.on('will-quit', () => { localBridge?.closeSync(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
