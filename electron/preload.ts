import { contextBridge, ipcRenderer } from 'electron';
import type { SourcefieldAPI, ScanProgress, CodeMap, RemoteViewCommand } from '../shared/types';
const api: SourcefieldAPI = {
  ready: () => ipcRenderer.invoke('sourcefield:ready'),
  openFolder: () => ipcRenderer.invoke('sourcefield:folder'),
  openMap: () => ipcRenderer.invoke('sourcefield:open'),
  exportMap: view => ipcRenderer.invoke('sourcefield:export', view),
  cancelScan: () => ipcRenderer.invoke('sourcefield:cancel'),
  getScanState: () => ipcRenderer.invoke('sourcefield:scan-state'),
  setIncludeDependencies: include => ipcRenderer.invoke('sourcefield:dependencies', include),
  getMcpConfiguration: () => ipcRenderer.invoke('sourcefield:mcp-config'),
  copyMcpConfiguration: client => ipcRenderer.invoke('sourcefield:mcp-copy', client),
  onRemoteView: callback => {
    const handler = async (_event: Electron.IpcRendererEvent, request: { id: string; command: RemoteViewCommand }) => {
      try { ipcRenderer.send('sourcefield:view-result', { id: request.id, ok: true, value: await callback(request.command) }); }
      catch (error) { ipcRenderer.send('sourcefield:view-result', { id: request.id, ok: false, error: error instanceof Error ? error.message : 'View is unavailable.' }); }
    };
    ipcRenderer.on('sourcefield:remote-view', handler); return () => ipcRenderer.removeListener('sourcefield:remote-view', handler);
  },
  onProgress: callback => {
    const handler = (_event: Electron.IpcRendererEvent, value: ScanProgress) => callback(value);
    ipcRenderer.on('sourcefield:progress', handler); return () => ipcRenderer.removeListener('sourcefield:progress', handler);
  },
  onMap: callback => {
    const handler = (_event: Electron.IpcRendererEvent, value: CodeMap) => callback(value);
    ipcRenderer.on('sourcefield:map', handler); return () => ipcRenderer.removeListener('sourcefield:map', handler);
  },
  onCommand: callback => {
    const handler = (_event: Electron.IpcRendererEvent, command: Parameters<Parameters<SourcefieldAPI['onCommand']>[0]>[0]) => callback(command);
    ipcRenderer.on('sourcefield:command', handler); return () => ipcRenderer.removeListener('sourcefield:command', handler);
  }
};
contextBridge.exposeInMainWorld('sourcefield', Object.freeze(api));
