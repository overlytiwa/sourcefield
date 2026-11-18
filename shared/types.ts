export type NodeKind = 'folder' | 'file' | 'class' | 'function' | 'method' | 'variable' | 'parameter' | 'property' | 'interface' | 'type' | 'enum' | 'namespace' | 'import';
export type EdgeKind = 'contains' | 'imports' | 'exports' | 'calls' | 'inherits' | 'references';
export type Vec3 = [number, number, number];
export interface MapNode {
  id: string; name: string; kind: NodeKind; path: string;
  line?: number; column?: number; endLine?: number; parent?: string;
  language?: string; signature?: string; excerpt?: string; exported?: boolean;
  status?: 'analyzed' | 'unsupported' | 'skipped' | 'partial';
  position: Vec3; degree: number;
}
export interface MapEdge {
  id: string; source: string; target: string; kind: EdgeKind;
  line?: number; path?: string; count: number;
  locations?: { path: string; line: number; column?: number }[];
}
export interface Issue {
  kind: 'unsupported' | 'unresolved' | 'external' | 'parse' | 'skipped' | 'limit';
  path: string; line?: number; source?: string; relationship?: EdgeKind;
  name: string; reason: string;
}
export interface ViewState {
  position: Vec3; target: Vec3; selected: string | null;
  visibleEdges: EdgeKind[]; labels: boolean;
}
export interface CodeMap {
  format: 'sourcefield.code-map'; version: 1; createdAt: string;
  project: { name: string; files: number; analyzed: number; languages: string[]; ignored: number };
  nodes: MapNode[]; edges: MapEdge[]; issues: Issue[];
  layout: { algorithm: 'spherical-graph-v1'; seed: number; radius: number };
  view?: ViewState;
}
export interface ScanProgress { phase: string; detail: string; percent: number; files?: number; symbols?: number }
export interface RemoteViewCommand {
  action: 'focus' | 'select' | 'highlight' | 'fit' | 'zoom' | 'clear' | 'layers' | 'inspect';
  node_id?: string; node_ids?: string[]; factor?: number; edge_kinds?: EdgeKind[]; labels?: boolean;
}
export interface RemoteViewResult { [key: string]: unknown; view: ViewState; highlighted_node_ids: string[] }
export interface McpConfiguration { running: boolean; transport: 'stdio'; command: string; args: string[]; claude: string; codex: string }
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string; cancelled?: boolean };
export interface SourcefieldAPI {
  ready(): Promise<ActionResult<CodeMap | null>>;
  openFolder(): Promise<ActionResult<CodeMap>>;
  openMap(): Promise<ActionResult<CodeMap>>;
  exportMap(view: ViewState): Promise<ActionResult<{ name: string }>>;
  cancelScan(): Promise<void>;
  getMcpConfiguration(): Promise<McpConfiguration>;
  copyMcpConfiguration(client: 'claude' | 'codex'): Promise<void>;
  onRemoteView(callback: (command: RemoteViewCommand) => RemoteViewResult | Promise<RemoteViewResult>): () => void;
  onProgress(callback: (progress: ScanProgress) => void): () => void;
  onMap(callback: (map: CodeMap) => void): () => void;
  onCommand(callback: (command: 'open-folder' | 'open-map' | 'export' | 'search' | 'fit') => void): () => void;
}
export const EDGE_KINDS: EdgeKind[] = ['contains', 'imports', 'exports', 'calls', 'inherits', 'references'];
