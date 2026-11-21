import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  PanelLeft,
  Network,
  ArrowUpToLine,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  FileCode2,
  Folder,
  FolderOpen,
  Focus,
  Layers3,
  LoaderCircle,
  Maximize,
  Minus,
  Plus,
  Plug,
  Search,
  SlidersHorizontal,
  Type,
  X,
} from "lucide-react";
import {
  readRenderSettings,
  saveRenderSettings,
  type RenderStatus,
} from "./render-settings";
import { GraphScene } from "./graph";
import { graphDetail } from "./graph-detail";
import { Workbench } from "./components/Workbench";
import { FlatGraph } from "./components/FlatGraph";
import { McpSetup } from "./components/McpSetup";
import { userMessage } from "../shared/errors";
import type {
  RemoteViewCommand,
  RemoteViewResult,
  ScanState,
} from "../shared/types";
import { SourcefieldIcon } from "./components/SourcefieldIcon";
import {
  EDGE_KINDS,
  type CodeMap,
  type EdgeKind,
  type Issue,
  type MapNode,
  type ScanProgress,
} from "../shared/types";

const number = (v: number) => v.toLocaleString();
const edgeNames: Record<EdgeKind, string> = {
  contains: "Containment",
  imports: "Imports",
  exports: "Exports",
  calls: "Calls",
  inherits: "Inheritance",
  references: "References",
  dispatches: "Messages",
};
const Icon = ({ node, size = 16 }: { node: MapNode; size?: number }) =>
  node.kind === "folder" ? (
    <Folder size={size} />
  ) : node.kind === "file" ? (
    <FileCode2 size={size} />
  ) : node.kind === "class" || node.kind === "interface" ? (
    <Braces size={size} />
  ) : (
    <Code2 size={size} />
  );

export default function App() {
  const [workbenchOpen, setWorkbenchOpen] = useState(false),
    [flat, setFlat] = useState(false),
    [scope, setScope] = useState<"structure" | "all" | "focus">("structure"),
    [focusIds, setFocusIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState<string[]>([]),
    [watching, setWatching] = useState(false),
    [autoRefresh, setAutoRefresh] = useState(true);
  const [history, setHistory] = useState<string[]>([]),
    [historyAt, setHistoryAt] = useState(-1);
  const [map, setMap] = useState<CodeMap | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [searchIndex, setSearchIndex] = useState(0);
  const [renderSettings, setRenderSettings] = useState(readRenderSettings);
  const [scanState, setScanState] = useState<ScanState>({
    includeDependencies: false,
    canRescan: false,
  });
  const [renderStatus, setRenderStatus] = useState<RenderStatus>({
    glowActive: true,
    reduced: false,
  });
  const reducedNotice = useRef(false);
  const [edges, setEdges] = useState<EdgeKind[]>(EDGE_KINDS),
    [labels, setLabels] = useState(true),
    [filters, setFilters] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false),
    [issueKind, setIssueKind] = useState("all"),
    [issueCount, setIssueCount] = useState(100);
  const [mcpSetup, setMcpSetup] = useState(false);
  const remoteView = useRef<(command: RemoteViewCommand) => RemoteViewResult>(
    () => {
      throw new Error("The graph is loading. Try again shortly.");
    },
  );
  const [help, setHelp] = useState(false),
    [message, setMessage] = useState(""),
    [renderError, setRenderError] = useState("");
  const [zoom, setZoom] = useState(1),
    [hover, setHover] = useState<{
      node: MapNode;
      x: number;
      y: number;
    } | null>(null);
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<GraphScene | null>(null),
    searchInput = useRef<HTMLInputElement>(null);
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const lastAutoAttempt = useRef<string[] | null>(null);
  const renderedMap = useRef<CodeMap | null>(null);
  const actions = useRef({
    openFolder: () => {},
    openMap: () => {},
    exportMap: () => {},
  });
  const nodeIndex = useMemo(
    () => new Map(map?.nodes.map((n) => [n.id, n]) ?? []),
    [map],
  );
  const node = selected ? nodeIndex.get(selected) : undefined;
  const relationshipIndex = useMemo(
    () => (map ? graphDetail(map) : null),
    [map],
  );
  const acceptMap = useCallback((value: CodeMap, preserve = false) => {
    if (preserve && scene.current) {
      const view = scene.current.capture();
      value = {
        ...value,
        view: {
          ...view,
          selected: value.nodes.some((n) => n.id === view.selected)
            ? view.selected
            : null,
        },
      };
    }
    if (!preserve) setDirty([]);
    setMap(value);
    setSelected(value.view?.selected ?? null);
    setEdges(value.view?.visibleEdges ?? EDGE_KINDS);
    setLabels(value.view?.labels ?? true);
    setQuery("");
    setSearchOpen(false);
    setIssuesOpen(false);
    setBusy(false);
    setProgress(null);
    setMessage("");
    setScanState({
      includeDependencies: value.scan?.includeDependencies ?? false,
      canRescan: false,
    });
    window.sourcefield
      ?.getScanState()
      .then(setScanState)
      .catch(() => {});
  }, []);
  useEffect(() => {
    try {
      scene.current = new GraphScene(
        host.current!,
        (id) => {
          setSelected(id);
          setIssuesOpen(false);
        },
        (node, x, y) => setHover(node ? { node, x, y } : null),
        (level) =>
          setZoom((old) => (Math.abs(old - level) > 0.015 ? level : old)),
        (status) => {
          setRenderStatus(status);
          if (status.reduced && !reducedNotice.current)
            setMessage(
              "Glow paused automatically to improve performance. Restore it in view settings.",
            );
          reducedNotice.current = status.reduced;
        },
      );
    } catch (e) {
      setRenderError(
        `The 3D view could not start. ${e instanceof Error ? e.message : "WebGL is unavailable."}`,
      );
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    saveRenderSettings(renderSettings);
    scene.current?.setRendering(renderSettings);
  }, [renderSettings]);
  useEffect(() => {
    if (!window.sourcefield) return;
    const cleanups = [
      window.sourcefield.onUpdateReady((version) =>
        setMessage(
          `Sourcefield ${version} downloaded. The update installs when you restart the app.`,
        ),
      ),
      window.sourcefield.onDirty((value) => {
        setDirty(value.paths);
        setWatching(value.watching);
      }),
      window.sourcefield.onRemoteView((command) => remoteView.current(command)),
      window.sourcefield.onProgress((p) => {
        setProgress(p);
        setBusy(p.percent < 100);
      }),
      window.sourcefield.onMap((value) => acceptMap(value)),
      window.sourcefield.onCommand((command) => {
        if (command === "open-folder") actions.current.openFolder();
        if (command === "open-map") actions.current.openMap();
        if (command === "export") actions.current.exportMap();
        if (command === "search") searchInput.current?.focus();
        if (command === "fit") scene.current?.fit();
      }),
    ];
    window.sourcefield
      .ready()
      .then((result) => {
        if (result.ok && result.value) acceptMap(result.value);
        else if (!result.ok && !result.cancelled) setMessage(result.error);
      })
      .catch((error) =>
        setMessage(
          userMessage(
            error,
            "The project couldn’t be opened. Try opening it again.",
          ),
        ),
      );
    return () => cleanups.forEach((fn) => fn());
  }, [acceptMap]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHelp(false);
        setMcpSetup(false);
        setFilters(false);
        setSearchOpen(false);
        searchInput.current?.blur();
      }
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function open(type: "folder" | "map") {
    if (busy) return;
    if (!window.sourcefield) {
      setMessage(
        "Run Sourcefield as a desktop app to open local folders and saved maps.",
      );
      return;
    }
    setMessage("");
    setBusy(true);
    try {
      const result = await (type === "folder"
        ? window.sourcefield.openFolder()
        : window.sourcefield.openMap());
      if (result.ok) acceptMap(result.value);
      else if (!result.cancelled) setMessage(result.error);
    } catch (e) {
      setMessage(
        userMessage(e, "The project couldn’t be opened. Try opening it again."),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  async function exportMap() {
    if (!map || !window.sourcefield || !scene.current || exporting) return;
    setExporting(true);
    try {
      const result = await window.sourcefield.exportMap(
        scene.current.capture(),
      );
      if (result.ok) setMessage(`Saved ${result.value.name}`);
      else if (!result.cancelled) setMessage(result.error);
    } catch (e) {
      setMessage(
        userMessage(
          e,
          "The map couldn’t be saved. Try choosing another location.",
        ),
      );
    } finally {
      setExporting(false);
    }
  }
  async function changeDependencies(include: boolean) {
    if (busy || !scanState.canRescan || !window.sourcefield) return;
    setBusy(true);
    setFilters(false);
    setMessage("");
    try {
      const result = await window.sourcefield.setIncludeDependencies(include);
      if (result.ok) acceptMap(result.value, true);
      else if (!result.cancelled) setMessage(result.error);
    } catch (error) {
      setMessage(
        userMessage(
          error,
          "The project couldn’t be updated. Try refreshing it again.",
        ),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  async function refresh(): Promise<boolean> {
    if (refreshInFlight.current) return refreshInFlight.current;
    if (busy || !window.sourcefield) return false;
    const pending = (async () => {
      setBusy(true);
      setMessage("");
      try {
        const result = await window.sourcefield!.refresh();
        if (result.ok) {
          acceptMap(result.value, true);
          return true;
        }
        if (!result.cancelled) setMessage(result.error);
      } catch (e) {
        setMessage(
          userMessage(
            e,
            "The project couldn’t be updated. Try refreshing it again.",
          ),
        );
      } finally {
        setBusy(false);
        setProgress(null);
      }
      return false;
    })();
    refreshInFlight.current = pending;
    try {
      return await pending;
    } finally {
      refreshInFlight.current = null;
    }
  }
  useEffect(() => {
    if (
      !autoRefresh ||
      !dirty.length ||
      busy ||
      lastAutoAttempt.current === dirty
    )
      return;
    const timer = setTimeout(() => {
      lastAutoAttempt.current = dirty;
      void refresh();
    }, 1200);
    return () => clearTimeout(timer);
  }, [autoRefresh, dirty, busy]);
  const visibleMap = useMemo(() => {
    if (!map) return null;
    const ids =
      scope === "all"
        ? null
        : scope === "structure"
          ? new Set(
              map.nodes
                .filter((n) => n.kind === "folder" || n.kind === "file")
                .map((n) => n.id),
            )
          : new Set(focusIds);
    if (!ids) return map;
    const nodes = map.nodes.filter((n) => ids.has(n.id));
    const valid = new Set(nodes.map((n) => n.id));
    return {
      ...map,
      nodes,
      edges: map.edges.filter(
        (e) => valid.has(e.source) && valid.has(e.target),
      ),
      view: map.view
        ? {
            ...map.view,
            selected: valid.has(map.view.selected ?? "")
              ? map.view.selected
              : null,
          }
        : undefined,
    };
  }, [map, scope, focusIds]);
  useEffect(() => {
    if (!visibleMap || !scene.current) return;
    const ids =
      scope === "all" ? null : visibleMap.nodes.map((node) => node.id);
    if (renderedMap.current !== map) {
      scene.current.load(map!, ids);
      renderedMap.current = map;
    } else scene.current.setScope(ids);
    const target = visibleMap.nodes.some((node) => node.id === selected)
      ? selected
      : null;
    if (scene.current.capture().selected !== target)
      scene.current.setSelected(target);
  }, [visibleMap]);
  useEffect(() => scene.current?.setActive(!flat), [flat]);
  function focusNodes(ids: string[]) {
    setFocusIds([...new Set(ids)].slice(0, 500));
    setScope("focus");
  }
  function reveal(id: string) {
    setSelected(id);
    setIssuesOpen(false);
    setSearchOpen(false);
    if (scope !== "all") {
      const neighbors = [...(relationshipIndex?.neighbors(id) ?? [])];
      focusNodes([id, ...neighbors]);
    }
    scene.current?.focus(id);
  }
  remoteView.current = (command) => {
    if (!scene.current || !map)
      throw new Error(
        "The visualization is not ready. Open a project or map first.",
      );
    if (command.node_id || command.node_ids) {
      setScope("all");
      scene.current.setScope(null);
    }
    const result = scene.current.applyRemote(command);
    if (command.action !== "inspect") {
      setSelected(result.view.selected);
      setEdges(result.view.visibleEdges);
      setLabels(result.view.labels);
      setHover(null);
      if (["focus", "select", "highlight", "clear"].includes(command.action))
        setIssuesOpen(false);
    }
    return result;
  };
  actions.current = {
    openFolder: () => open("folder"),
    openMap: () => open("map"),
    exportMap,
  };
  function choose(id: string) {
    setHistory((h) => [...h.slice(0, historyAt + 1), id]);
    setHistoryAt(historyAt + 1);
    reveal(id);
  }
  const matches = useMemo(() => {
    if (!map || !query.trim()) return [];
    const q = query.toLowerCase().trim();
    return map.nodes
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          (a.name.toLowerCase() === q
            ? -10
            : a.name.toLowerCase().startsWith(q)
              ? -5
              : 0) -
            (b.name.toLowerCase() === q
              ? -10
              : b.name.toLowerCase().startsWith(q)
                ? -5
                : 0) || b.degree - a.degree,
      )
      .slice(0, 60);
  }, [map, query]);
  const connections = useMemo(
    () =>
      (selected ? relationshipIndex?.connections(selected) : [])?.sort(
        (a, b) => (a.kind === "calls" ? -1 : 0) - (b.kind === "calls" ? -1 : 0),
      ) ?? [],
    [relationshipIndex, selected],
  );
  const visibleIssues = useMemo(
    () =>
      map?.issues.filter((i) => issueKind === "all" || i.kind === issueKind) ??
      [],
    [map, issueKind],
  );
  const [connectionCount, setConnectionCount] = useState(100);
  useEffect(() => setConnectionCount(100), [selected]);
  const stats = useMemo(
    () => ({
      symbols:
        map?.nodes.filter((n) => n.kind !== "file" && n.kind !== "folder")
          .length ?? 0,
      unresolved:
        map?.issues.filter((i) => i.kind === "unresolved").length ?? 0,
      unsupported:
        map?.issues.filter((i) => i.kind === "unsupported").length ?? 0,
    }),
    [map],
  );
  const sidebar = !!node || issuesOpen;
  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <SourcefieldIcon size={26} />
          <span>Sourcefield</span>
          {map && (
            <>
              <span className="brand-divider" />
              <span className="project-name" title={map.project.name}>
                {map.project.name}
              </span>
            </>
          )}
        </div>
        <div className="toolbar-actions">
          {map && (
            <>
              <button
                className="icon-button"
                aria-label="Open developer workbench"
                title="Changes, investigations, debugging and tours"
                onClick={() => setWorkbenchOpen((v) => !v)}
              >
                <PanelLeft size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Refresh project"
                title="Refresh project"
                disabled={busy || !scanState.canRescan}
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} />
              </button>
            </>
          )}
          <button
            className="button subtle"
            onClick={() => open("folder")}
            disabled={busy}
            title="Open project folder · Ctrl/⌘ O"
          >
            <FolderOpen size={15} />
            <span>Open folder</span>
          </button>
          <button
            className="icon-button"
            onClick={() => open("map")}
            disabled={busy}
            title="Open saved map · Ctrl/⌘ Shift O"
            aria-label="Open saved map"
          >
            <FileCode2 size={16} />
          </button>
          <div className="search-wrap">
            <Search size={14} className="search-icon" />
            <input
              ref={searchInput}
              aria-label="Search symbols and files"
              placeholder="Find a symbol or file…"
              value={query}
              disabled={!map}
              role="combobox"
              aria-expanded={searchOpen && !!query}
              aria-controls="search-results"
              aria-activedescendant={
                matches[searchIndex]
                  ? `result-${matches[searchIndex].id}`
                  : undefined
              }
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchIndex(0);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSearchIndex((i) => Math.min(i + 1, matches.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSearchIndex((i) => Math.max(0, i - 1));
                }
                if (e.key === "Enter" && matches[searchIndex])
                  choose(matches[searchIndex].id);
              }}
            />
            <kbd>/</kbd>
            {searchOpen && query && (
              <>
                <button
                  className="dismiss-layer"
                  tabIndex={-1}
                  aria-label="Close search"
                  onClick={() => setSearchOpen(false)}
                />
                <div
                  className="search-results"
                  id="search-results"
                  role="listbox"
                >
                  <div className="popover-caption">
                    {matches.length
                      ? `${number(matches.length)} results${matches.length === 60 ? " · top matches" : ""}`
                      : "No matching symbols or files"}
                  </div>
                  {matches.map((n, i) => (
                    <button
                      key={n.id}
                      id={`result-${n.id}`}
                      role="option"
                      aria-selected={i === searchIndex}
                      className={`search-result ${i === searchIndex ? "active" : ""}`}
                      onMouseEnter={() => setSearchIndex(i)}
                      onClick={() => choose(n.id)}
                    >
                      <Icon node={n} />
                      <span>
                        <strong>{n.name}</strong>
                        <small>
                          {n.path}
                          {n.line ? `:${n.line}` : ""}
                        </small>
                      </span>
                      <em>{n.kind}</em>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            className="button export-button"
            disabled={!map || busy || exporting}
            onClick={exportMap}
            title="Export portable map · Ctrl/⌘ E"
          >
            {exporting ? (
              <LoaderCircle className="spinning" size={14} />
            ) : (
              <ArrowUpToLine size={14} />
            )}
            <span>Export</span>
          </button>
        </div>
      </header>

      <section
        className={`workspace ${sidebar && !workbenchOpen ? "has-sidebar" : ""} ${workbenchOpen ? "workbench-open" : ""}`}
        aria-label="Code map workspace"
      >
        {workbenchOpen && map && (
          <Workbench
            map={map}
            selected={selected}
            onSelect={choose}
            onFocus={focusNodes}
            onClose={() => setWorkbenchOpen(false)}
            capture={() => scene.current?.capture()}
            onRestore={(view) => {
              setScope("all");
              scene.current?.setScope(null);
              scene.current?.restore(view);
              setSelected(view.selected);
              setEdges(view.visibleEdges);
              setLabels(view.labels);
            }}
            notify={setMessage}
            onRefresh={refresh}
          />
        )}
        <div className="viewport">
          <div
            className="graph-host"
            ref={host}
            style={{ visibility: flat ? "hidden" : "visible" }}
          />
          {!flat &&
            map &&
            renderStatus.visibleNodes !== undefined &&
            ((renderStatus.visibleNodes ?? 0) < map.nodes.length ||
              (renderStatus.visibleConnections ?? 0) < map.edges.length) && (
              <p className="graph-detail" role="status">
                Showing {number(renderStatus.visibleNodes)} of{" "}
                {number(map.nodes.length)} nodes and{" "}
                {number(renderStatus.visibleConnections ?? 0)} of{" "}
                {number(map.edges.length)} connections. Zoom in or select code
                for more detail.
              </p>
            )}
          {flat && visibleMap && (
            <FlatGraph map={visibleMap} selected={selected} onSelect={choose} />
          )}
          {!map && !busy && (
            <div className="empty-state">
              <SourcefieldIcon size={64} className="empty-icon" />
              <h1>Your code, connected.</h1>
              <p>
                See the structure behind your project.
                <br />
                Every symbol. Every connection. A new perspective.
              </p>
              <div className="empty-actions">
                <button
                  className="button primary"
                  onClick={() => open("folder")}
                >
                  <FolderOpen size={16} />
                  Open a project folder
                </button>
                <button className="button subtle" onClick={() => open("map")}>
                  Open a saved map
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="terminal-hint">
                <code>sourcefield .</code>
                <span>or start from your terminal</span>
              </div>
              <small className="supported-copy">
                JavaScript · TypeScript · Kotlin · Dart · Scala · Bash · Python
                · Go · Rust · Java · C · C++ · C# · PHP · Ruby
              </small>
            </div>
          )}
          {map && (
            <>
              <div className="map-heading">
                <span className="eyebrow">PROJECT MAP</span>
                <h1>{map.project.name}</h1>
                <p>
                  {map.project.languages.join(" · ") || "Folder structure"}
                  <span className="heading-dot">·</span>
                  {number(map.project.files)} files
                </p>
              </div>
              <div className="view-tools">
                <button
                  className="icon-button"
                  aria-label="Back"
                  disabled={historyAt <= 0}
                  onClick={() => {
                    setHistoryAt(historyAt - 1);
                    reveal(history[historyAt - 1]);
                  }}
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Forward"
                  disabled={historyAt >= history.length - 1}
                  onClick={() => {
                    setHistoryAt(historyAt + 1);
                    reveal(history[historyAt + 1]);
                  }}
                >
                  <ArrowRight size={15} />
                </button>
                <select
                  aria-label="Map scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as typeof scope)}
                >
                  <option value="structure">Structure</option>
                  <option value="all">All symbols</option>
                  <option value="focus">Focused code</option>
                </select>
                <button
                  className="icon-button"
                  aria-label="Toggle flat map"
                  aria-pressed={flat}
                  title="Switch between 3D and directed flat views"
                  onClick={() => setFlat((v) => !v)}
                >
                  <Network size={16} />
                </button>
                <div className="filter-wrap">
                  <button
                    className={`icon-button ${filters ? "pressed" : ""}`}
                    title="View settings: dependencies, layers and glow"
                    aria-label="View settings"
                    aria-expanded={filters}
                    onClick={() => setFilters((v) => !v)}
                  >
                    <SlidersHorizontal size={16} />
                  </button>
                  {filters && (
                    <>
                      <button
                        className="dismiss-layer"
                        tabIndex={-1}
                        onClick={() => setFilters(false)}
                        aria-label="Close layers"
                      />
                      <div className="layers-menu">
                        <div className="popover-caption">Connection layers</div>
                        {EDGE_KINDS.map((kind) => (
                          <label key={kind}>
                            <input
                              type="checkbox"
                              checked={edges.includes(kind)}
                              onChange={() => {
                                const next = edges.includes(kind)
                                  ? edges.filter((k) => k !== kind)
                                  : [...edges, kind];
                                setEdges(next);
                                scene.current?.setEdges(next);
                              }}
                            />
                            <span>{edgeNames[kind]}</span>
                            <small>
                              {number(
                                map.edges.filter((e) => e.kind === kind).length,
                              )}
                            </small>
                          </label>
                        ))}
                        <div className="scan-options">
                          <div className="popover-caption">Project code</div>
                          <label>
                            <input
                              type="checkbox"
                              checked={scanState.includeDependencies}
                              disabled={busy || !scanState.canRescan}
                              onChange={(e) =>
                                void changeDependencies(e.target.checked)
                              }
                            />
                            <span>Show dependency code</span>
                          </label>
                          <p className="render-note">
                            {!scanState.canRescan
                              ? "Open the project folder to change the contents of this saved map."
                              : scanState.includeDependencies
                                ? "Dependencies included. Turn off to simplify the map. Changing this rescans the project."
                                : `${number(map.scan?.excludedDependencyCount ?? 0)} dependency folders excluded. Turn on to include them and rescan.`}
                          </p>
                        </div>
                        <div className="render-options">
                          <label>
                            <input
                              type="checkbox"
                              checked={renderSettings.glowEnabled}
                              onChange={(e) =>
                                setRenderSettings((s) => ({
                                  ...s,
                                  glowEnabled: e.target.checked,
                                }))
                              }
                            />
                            <span>Glow effects</span>
                          </label>
                          <div className="glow-slider">
                            <span>Strength</span>
                            <input
                              type="range"
                              aria-label="Glow strength"
                              min="0"
                              max="2.5"
                              step="0.05"
                              value={renderSettings.glowStrength}
                              disabled={!renderSettings.glowEnabled}
                              onChange={(e) =>
                                setRenderSettings((s) => ({
                                  ...s,
                                  glowStrength: Number(e.target.value),
                                }))
                              }
                            />
                            <output>
                              {renderSettings.glowStrength.toFixed(2)}
                            </output>
                          </div>
                          <label>
                            <input
                              type="checkbox"
                              checked={renderSettings.autoPerformance}
                              onChange={(e) =>
                                setRenderSettings((s) => ({
                                  ...s,
                                  autoPerformance: e.target.checked,
                                }))
                              }
                            />
                            <span>Automatic performance</span>
                          </label>
                          <p className="render-note">
                            {renderStatus.reduced
                              ? "Glow paused: sustained low frame rate."
                              : renderStatus.glowActive
                                ? renderSettings.autoPerformance
                                  ? "Glow turns off if rendering stays slow."
                                  : "Glow is on. Adjust its strength above."
                                : "Glow is off. The map stays interactive."}
                          </p>
                          {renderStatus.reduced && (
                            <button
                              className="button subtle load-more"
                              onClick={() => scene.current?.restoreGlow()}
                            >
                              Restore glow
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <button
                  className={`icon-button ${labels ? "" : "off"}`}
                  title={labels ? "Hide labels" : "Enable progressive labels"}
                  aria-label="Toggle labels"
                  aria-pressed={labels}
                  onClick={() => {
                    setLabels((v) => !v);
                    scene.current?.setLabels(!labels);
                  }}
                >
                  <Type size={16} />
                </button>
              </div>
              <div className="graph-bottom">
                <div className="interaction-hint">
                  <span>Drag to orbit</span>
                  <span>Right-drag to pan</span>
                  <span>Scroll to explore</span>
                </div>
                <div className="zoom-tools">
                  <span className="zoom-description">
                    {zoom > 0.88
                      ? "Overview"
                      : zoom > 0.48
                        ? "Structure"
                        : "Symbols"}
                  </span>
                  <button
                    className="icon-button"
                    title="Zoom out"
                    aria-label="Zoom out"
                    onClick={() => scene.current?.zoom(1.25)}
                  >
                    <Minus size={15} />
                  </button>
                  <button
                    className="icon-button"
                    title="Zoom in"
                    aria-label="Zoom in"
                    onClick={() => scene.current?.zoom(0.8)}
                  >
                    <Plus size={15} />
                  </button>
                  <span className="tool-divider" />
                  <button
                    className="icon-button"
                    title="Fit map · Shift F"
                    aria-label="Fit map"
                    onClick={() => scene.current?.fit()}
                  >
                    <Maximize size={15} />
                  </button>
                </div>
              </div>
            </>
          )}
          {hover && map && !busy && (
            <div
              className="node-tooltip"
              style={{
                left: Math.min(
                  hover.x + 15,
                  Math.max(12, (host.current?.clientWidth ?? 800) - 250),
                ),
                top: Math.max(12, hover.y - 48),
              }}
            >
              <strong>{hover.node.name}</strong>
              <span>
                {hover.node.kind}
                {hover.node.line ? ` · line ${hover.node.line}` : ""}
              </span>
            </div>
          )}
          {renderError && (
            <div className="render-error" role="alert">
              {renderError}
            </div>
          )}
          {busy && (
            <div className="scan-overlay">
              <div className="scan-panel">
                <LoaderCircle
                  size={26}
                  strokeWidth={1.5}
                  className="spinning"
                />
                <h2>{progress?.phase ?? "Opening project"}</h2>
                <p>
                  {progress?.detail ?? "Choose a local project or saved map."}
                </p>
                <div className="progress-track">
                  <div style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
                <div className="scan-meta">
                  <span>
                    {progress?.files
                      ? `${number(progress.files)} files`
                      : "Everything stays on your computer"}
                  </span>
                  <span>{Math.round(progress?.percent ?? 0)}%</span>
                </div>
                {progress && (
                  <button
                    className="button subtle cancel-button"
                    onClick={() => {
                      window.sourcefield?.cancelScan();
                    }}
                  >
                    Cancel scan
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {sidebar && !workbenchOpen && (
          <aside className="sidebar">
            <div className="sidebar-top">
              <span className="eyebrow">
                {issuesOpen ? "ANALYSIS REPORT" : "NODE INSPECTOR"}
              </span>
              <button
                className="icon-button"
                aria-label="Close inspector"
                onClick={() => {
                  setIssuesOpen(false);
                  setSelected(null);
                  scene.current?.setSelected(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
            {issuesOpen ? (
              <>
                <div className="inspector-intro">
                  <h2>Analysis details</h2>
                  <p>
                    What Sourcefield could resolve, and what still needs
                    context.
                  </p>
                </div>
                <div className="report-summary">
                  <div>
                    <strong>{number(map!.project.analyzed)}</strong>
                    <span>files analyzed</span>
                  </div>
                  <div>
                    <strong>{number(map!.project.ignored)}</strong>
                    <span>entries ignored</span>
                  </div>
                </div>
                {!!map?.scan?.excludedDependencyCount && (
                  <details className="excluded-folders">
                    <summary>
                      {number(map.scan.excludedDependencyCount)} dependency
                      folders excluded
                    </summary>
                    <p>
                      Turn on Show dependency code in view settings to rescan
                      with installed libraries.
                    </p>
                    <ul>
                      {map.scan.excludedDependencies
                        .slice(0, 50)
                        .map((folder) => (
                          <li key={folder.path}>
                            <strong>{folder.path}</strong>
                            <span>{folder.reason}</span>
                          </li>
                        ))}
                    </ul>
                    {map.scan.excludedDependencyCount > 50 && (
                      <p>Showing the first 50 excluded folders.</p>
                    )}
                  </details>
                )}
                <label className="report-filter">
                  <span>Show</span>
                  <select
                    value={issueKind}
                    onChange={(e) => {
                      setIssueKind(e.target.value);
                      setIssueCount(100);
                    }}
                  >
                    <option value="all">All diagnostics</option>
                    <option value="unsupported">Unsupported files</option>
                    <option value="unresolved">Unresolved relationships</option>
                    <option value="external">External relationships</option>
                    <option value="parse">Syntax issues</option>
                    <option value="skipped">Skipped files</option>
                    <option value="limit">Limits</option>
                  </select>
                </label>
                <div className="issues-list">
                  {visibleIssues.slice(0, issueCount).map((i, index) => (
                    <IssueRow
                      key={index}
                      issue={i}
                      onSelect={
                        i.source && nodeIndex.has(i.source)
                          ? () => choose(i.source!)
                          : undefined
                      }
                    />
                  ))}
                  {!visibleIssues.length && (
                    <p className="muted small">
                      No diagnostics in this category.
                    </p>
                  )}
                  {visibleIssues.length > issueCount && (
                    <button
                      className="button subtle load-more"
                      onClick={() => setIssueCount((n) => n + 100)}
                    >
                      Show 100 more
                      <ChevronDown size={14} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              node && (
                <>
                  <div className="inspector-intro">
                    <div className="node-kind">
                      <Icon node={node} size={17} />
                      <span>
                        {node.kind}
                        {node.exported ? " · exported" : ""}
                      </span>
                    </div>
                    <h2>{node.name}</h2>
                    <p className="source-path">{node.path}</p>
                  </div>
                  <dl className="node-metadata">
                    {node.language && (
                      <div>
                        <dt>Language</dt>
                        <dd>{node.language}</dd>
                      </div>
                    )}
                    {node.line && (
                      <div>
                        <dt>Location</dt>
                        <dd>
                          Line {node.line}
                          {node.column ? `, column ${node.column}` : ""}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Connections</dt>
                      <dd>{number(connections.length)}</dd>
                    </div>
                    {node.status && (
                      <div>
                        <dt>Analysis</dt>
                        <dd>{node.status}</dd>
                      </div>
                    )}
                  </dl>
                  <button
                    className="button subtle focus-button"
                    onClick={() => scene.current?.focus(node.id)}
                  >
                    <Focus size={14} />
                    Focus on node
                  </button>
                  <button
                    className="button subtle focus-button"
                    disabled={!scanState.canRescan}
                    onClick={() =>
                      window
                        .sourcefield!.workbench("open-source", {
                          node_id: node.id,
                        })
                        .catch((e) => setMessage(userMessage(e)))
                    }
                  >
                    Open in VS Code at line {node.line ?? 1}
                  </button>
                  {node.signature && (
                    <div className="signature">{node.signature}</div>
                  )}
                  {node.excerpt && (
                    <section className="source-section">
                      <h3>Source preview</h3>
                      <pre>{node.excerpt}</pre>
                      <p>Saved snapshot at scan time</p>
                    </section>
                  )}
                  <section className="connections-section">
                    <div className="section-heading">
                      <h3>Direct connections</h3>
                      <span>{number(connections.length)}</span>
                    </div>
                    {connections.slice(0, connectionCount).map((edge) => {
                      const outgoing = edge.source === node.id,
                        other = nodeIndex.get(
                          outgoing ? edge.target : edge.source,
                        )!;
                      return (
                        <button
                          key={edge.id}
                          className="connection-row"
                          onClick={() => choose(other.id)}
                          title={
                            edge.path ? `${edge.path}:${edge.line}` : other.path
                          }
                        >
                          {outgoing ? (
                            <ArrowUpRight size={14} />
                          ) : (
                            <ArrowDownLeft size={14} />
                          )}
                          <span>
                            <strong>{other.name}</strong>
                            <small>
                              {edge.kind}
                              {edge.count > 1
                                ? ` · ${edge.count} occurrences`
                                : ""}
                              {edge.line ? ` · L${edge.line}` : ""}
                            </small>
                            <small className="connection-path">
                              {other.path}
                            </small>
                          </span>
                          <ChevronRight size={13} />
                        </button>
                      );
                    })}
                    {!connections.length && (
                      <p className="muted small">No resolved connections.</p>
                    )}
                    {connections.length > connectionCount && (
                      <button
                        className="button subtle load-more"
                        onClick={() => setConnectionCount((n) => n + 100)}
                      >
                        Show more
                        <ChevronDown size={14} />
                      </button>
                    )}
                  </section>
                </>
              )
            )}
          </aside>
        )}
      </section>
      <footer className="statusbar">
        <div>
          {map && (
            <>
              <button onClick={() => setWorkbenchOpen((v) => !v)}>
                Workbench
              </button>
              {dirty.length > 0 && (
                <button onClick={() => void refresh()}>
                  {dirty.length} changed paths · Refresh
                </button>
              )}
              <label className="auto-refresh">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto refresh
              </label>
            </>
          )}
          {map ? (
            <>
              <span>{number(map.nodes.length)} nodes</span>
              <span>{number(map.edges.length)} connections</span>
              <span>{number(stats.symbols)} symbols</span>
            </>
          ) : (
            <span>Local analysis. Your source stays yours.</span>
          )}
        </div>
        <div>
          {map && (
            <button
              onClick={() => {
                setIssuesOpen((v) => !v);
                setIssueKind("all");
              }}
            >
              <Layers3 size={12} />
              <span>
                {stats.unsupported
                  ? `${number(stats.unsupported)} unsupported`
                  : "Analysis report"}
                {stats.unresolved
                  ? ` · ${number(stats.unresolved)} unresolved`
                  : ""}
              </span>
              <ChevronRight size={12} />
            </button>
          )}
          <button
            title="Connect a desktop AI over MCP"
            aria-label="MCP connection setup"
            onClick={() => setMcpSetup(true)}
          >
            <Plug size={14} />
          </button>
          <button
            title="Controls and supported languages"
            aria-label="Help"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={14} />
          </button>
        </div>
      </footer>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setMessage("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {mcpSetup && <McpSetup onClose={() => setMcpSetup(false)} />}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              onClick={() => setHelp(false)}
              aria-label="Close help"
            >
              <X size={17} />
            </button>
            <SourcefieldIcon size={36} />
            <h2 id="help-title">Explore your Sourcefield</h2>
            <p>
              Labels emerge as you move closer. Files appear first, then
              individual symbols. Click a node to focus and inspect its direct
              connections.
            </p>
            <dl>
              <div>
                <dt>Orbit</dt>
                <dd>Left-drag</dd>
              </div>
              <div>
                <dt>Pan</dt>
                <dd>Right-drag / Shift-drag</dd>
              </div>
              <div>
                <dt>Zoom</dt>
                <dd>Scroll / pinch</dd>
              </div>
              <div>
                <dt>Find a symbol</dt>
                <dd>/ or Ctrl/⌘ F</dd>
              </div>
              <div>
                <dt>Fit the map</dt>
                <dd>Shift F</dd>
              </div>
              <div>
                <dt>From a terminal</dt>
                <dd>
                  <code>sourcefield .</code>
                </dd>
              </div>
            </dl>
            <p className="small">
              JavaScript, TypeScript, Kotlin, Dart, Scala, Bash, Python, Go,
              Rust, Java, C, C++, C#, PHP, and Ruby. Static analysis marks
              dynamic, external, and ambiguous targets in the analysis report.
              Saved .sourcefield maps include their layout and source previews.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
function IssueRow({
  issue,
  onSelect,
}: {
  issue: Issue;
  onSelect?: () => void;
}) {
  return (
    <article className="issue-row">
      <div>
        <span className="issue-kind">
          {issue.kind}
          {issue.relationship ? ` · ${issue.relationship}` : ""}
        </span>
        {onSelect && (
          <button
            className="icon-button"
            title="Inspect source node"
            onClick={onSelect}
          >
            <ArrowUpRight size={13} />
          </button>
        )}
      </div>
      <strong>{issue.name}</strong>
      <small>
        {issue.path}
        {issue.line ? `:${issue.line}` : ""}
      </small>
      <p>{issue.reason}</p>
    </article>
  );
}
