import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CodeMap,
  MapNode,
  MapEdge,
  RemoteViewCommand,
  RemoteViewResult,
} from "../../shared/types";
import type { Workbench } from "../workbench/service";
import { queryWorkbench, workbenchActions } from "./workbench";
import { toolSchemas, type ToolName } from "./contracts";

export class ProjectQuery {
  readonly id = randomUUID();
  private nodes: Map<string, MapNode>;
  private files: Map<string, MapNode>;
  private adjacent = new Map<string, MapEdge[]>();
  constructor(
    readonly map: CodeMap,
    readonly root: string | null,
    readonly workbench?: Workbench,
  ) {
    this.nodes = new Map(map.nodes.map((n) => [n.id, n]));
    this.files = new Map(
      map.nodes.filter((n) => n.kind === "file").map((n) => [n.path, n]),
    );
    for (const e of map.edges) {
      for (const id of new Set([e.source, e.target])) {
        const list = this.adjacent.get(id) ?? [];
        list.push(e);
        this.adjacent.set(id, list);
      }
    }
  }
  private requireNode(id: string) {
    const n = this.nodes.get(id);
    if (!n)
      throw new Error("Unknown node_id. Search again in the active project.");
    return n;
  }
  private summary(n: MapNode) {
    const parent = n.parent ? this.nodes.get(n.parent) : undefined;
    return {
      node_id: n.id,
      name: n.name,
      kind: n.kind,
      path: n.path,
      line: n.line,
      end_line: n.endLine,
      column: n.column,
      language: n.language,
      signature: n.signature?.slice(0, 320),
      parent: parent?.name,
      exported: n.exported,
      analysis: n.status,
      connections: this.adjacent.get(n.id)?.length ?? 0,
    };
  }
  private page<T>(items: T[], a: Record<string, any>) {
    return {
      total: items.length,
      offset: a.offset,
      next_offset:
        a.offset + a.limit < items.length ? a.offset + a.limit : null,
      results: items.slice(a.offset, a.offset + a.limit),
    };
  }
  private compactEdge(e: MapEdge) {
    return {
      edge_id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      occurrences: e.count,
      locations:
        e.locations?.slice(0, 4) ??
        (e.path && e.line ? [{ path: e.path, line: e.line }] : []),
    };
  }
  private async textFile(relative: string) {
    if (!this.root)
      throw new Error(
        "This is an offline map. Use node_id to retrieve saved source previews.",
      );
    if (!this.files.has(relative))
      throw new Error(
        "File is not in the scanned project. Search for a file node first.",
      );
    if (
      path.isAbsolute(relative) ||
      relative.includes("\\") ||
      relative.split("/").includes("..")
    )
      throw new Error("Provide a scanned, relative source path.");
    const root = await fs.realpath(this.root);
    const actual = await fs.realpath(path.join(root, relative));
    const within = path.relative(root, actual);
    if (
      !within ||
      within.startsWith(".." + path.sep) ||
      within === ".." ||
      path.isAbsolute(within)
    )
      throw new Error("Source path leaves the selected project.");
    const stat = await fs.stat(actual);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw new Error(
        "Source is not a regular file within the 2 MiB read limit.",
      );
    const bytes = await fs.readFile(actual);
    if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0))
      throw new Error("Binary or oversized files cannot be read as source.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      lines: text.split(/\r?\n/),
      newer: stat.mtimeMs > Date.parse(this.map.createdAt),
    };
  }
  async execute(
    name: ToolName,
    input: unknown,
    view: (command: RemoteViewCommand) => Promise<RemoteViewResult>,
  ) {
    const a = toolSchemas[name].parse(input) as Record<string, any>;
    if (a.project_id && a.project_id !== this.id)
      throw new Error(
        "The active project changed. Run project_overview or search again.",
      );
    let result: Record<string, any>;
    if (workbenchActions[name]) {
      if (!this.workbench) throw new Error("Desktop workbench is unavailable.");
      result = await queryWorkbench(this.workbench, name, a);
    } else
      switch (name) {
        case "project_overview": {
          const nodeKinds: Record<string, number> = {},
            edgeKinds: Record<string, number> = {},
            issueKinds: Record<string, number> = {};
          for (const n of this.map.nodes)
            nodeKinds[n.kind] = (nodeKinds[n.kind] ?? 0) + 1;
          for (const e of this.map.edges)
            edgeKinds[e.kind] = (edgeKinds[e.kind] ?? 0) + 1;
          for (const i of this.map.issues)
            issueKinds[i.kind] = (issueKinds[i.kind] ?? 0) + 1;
          result = {
            project: this.map.project,
            root: this.root,
            graph_created_at: this.map.createdAt,
            scan_scope: this.map.scan
              ? {
                  include_dependencies: this.map.scan.includeDependencies,
                  excluded_dependency_folders:
                    this.map.scan.excludedDependencyCount,
                  examples: this.map.scan.excludedDependencies.slice(0, 20),
                  examples_truncated:
                    this.map.scan.excludedDependencyCount > 20,
                }
              : null,
            source_mode: this.root
              ? "local_files_with_scan_time_graph"
              : "saved_map_previews",
            nodes: nodeKinds,
            relationships: edgeKinds,
            diagnostics: issueKinds,
            important_files: [...this.files.values()]
              .sort((a, b) => b.degree - a.degree)
              .slice(0, 10)
              .map((n) => this.summary(n)),
            guidance:
              "Search names first, inspect calls/references, then read specific source ranges. Unresolved relationships and unsupported languages are not inferred. Rescan in Sourcefield after edits to refresh graph locations.",
          };
          break;
        }
        case "search_symbols": {
          const query = a.query.toLowerCase().trim(),
            words = query.split(/\s+/);
          const matches = this.map.nodes
            .filter(
              (n) =>
                (!a.kinds || a.kinds.includes(n.kind)) &&
                (!a.language ||
                  n.language?.toLowerCase() === a.language.toLowerCase()) &&
                (!a.exported_only || n.exported) &&
                (!a.path_contains ||
                  n.path
                    .toLowerCase()
                    .includes(a.path_contains.toLowerCase())) &&
                words.every((w: string) =>
                  (n.name + " " + n.path).toLowerCase().includes(w),
                ),
            )
            .sort((l, r) => {
              const rank = (n: MapNode) =>
                n.name.toLowerCase() === query
                  ? 0
                  : n.name.toLowerCase().startsWith(query)
                    ? 1
                    : n.name.toLowerCase().includes(query)
                      ? 2
                      : 3;
              return (
                rank(l) - rank(r) ||
                (l.kind === "import" ? 1 : 0) - (r.kind === "import" ? 1 : 0) ||
                r.degree - l.degree ||
                l.path.localeCompare(r.path)
              );
            });
          result = this.page(
            matches.map((n) => ({
              ...this.summary(n),
              ...(a.include_preview && n.excerpt
                ? {
                    preview: n.excerpt
                      .split("\n")
                      .slice(0, 4)
                      .join("\n")
                      .slice(0, 480),
                  }
                : {}),
            })),
            a,
          );
          break;
        }
        case "get_symbol": {
          const n = this.requireNode(a.node_id),
            parents = [],
            seen = new Set<string>();
          let p = n.parent;
          while (p && !seen.has(p) && parents.length < 20) {
            seen.add(p);
            const next = this.nodes.get(p);
            if (!next) break;
            parents.unshift(this.summary(next));
            p = next.parent;
          }
          const connections: Record<
            string,
            { incoming: number; outgoing: number }
          > = {};
          for (const e of this.adjacent.get(n.id) ?? []) {
            connections[e.kind] ??= { incoming: 0, outgoing: 0 };
            if (e.source === n.id) connections[e.kind].outgoing++;
            if (e.target === n.id) connections[e.kind].incoming++;
          }
          result = {
            ...this.summary(n),
            containment: parents,
            connections,
            saved_source_preview: n.excerpt,
            preview_is_scan_time_snapshot: true,
            diagnostics: this.map.issues
              .filter((i) => i.source === n.id)
              .slice(0, 10),
          };
          break;
        }
        case "get_connections": {
          const n = this.requireNode(a.node_id);
          const matches = (this.adjacent.get(n.id) ?? []).filter(
            (e) =>
              a.kinds.includes(e.kind) &&
              (a.direction === "both" ||
                (a.direction === "incoming" ? e.target : e.source) === n.id),
          );
          result = {
            node: this.summary(n),
            ...this.page(
              matches.map((e) => ({
                ...this.compactEdge(e),
                direction: e.source === n.id ? "outgoing" : "incoming",
                other: this.summary(
                  this.requireNode(e.source === n.id ? e.target : e.source),
                ),
              })),
              a,
            ),
          };
          break;
        }
        case "trace_dependencies": {
          this.requireNode(a.node_id);
          const visited = new Set<string>([a.node_id]),
            links = new Map<string, MapEdge>();
          let frontier: string[] = [a.node_id],
            capped = false;
          for (let depth = 0; depth < a.depth && frontier.length; depth++) {
            const next: string[] = [];
            for (const current of frontier)
              for (const e of this.adjacent.get(current) ?? []) {
                if (
                  !a.kinds.includes(e.kind) ||
                  (a.direction === "incoming" ? e.target : e.source) !== current
                )
                  continue;
                const other = a.direction === "incoming" ? e.source : e.target;
                if (
                  (!visited.has(other) && visited.size >= a.max_nodes) ||
                  links.size >= 250
                ) {
                  capped = true;
                  continue;
                }
                links.set(e.id, e);
                if (!visited.has(other)) {
                  visited.add(other);
                  next.push(other);
                }
              }
            frontier = next;
          }
          result = {
            direction: a.direction,
            depth: a.depth,
            capped,
            nodes: [...visited].map((id) => this.summary(this.requireNode(id))),
            edges: [...links.values()].map((e) => this.compactEdge(e)),
            note: "Only resolved relationships in this bounded traversal are included. Cycles are preserved as edges; each node is visited once.",
          };
          break;
        }
        case "read_source": {
          const n = a.node_id ? this.requireNode(a.node_id) : undefined,
            relative = n?.path ?? a.path;
          const start = a.start_line ?? n?.line ?? 1;
          try {
            const content = await this.textFile(relative);
            const end = Math.min(
              content.lines.length,
              start + a.lines - 1,
              n?.endLine && !a.start_line ? n.endLine : Infinity,
            );
            const lines = content.lines
              .slice(start - 1, end)
              .map((text, i) => ({
                line: start + i,
                text: text.slice(0, 1200),
                truncated: text.length > 1200,
              }));
            result = {
              path: relative,
              source: "current_local_file",
              source_newer_than_graph: content.newer,
              start_line: start,
              end_line: lines.at(-1)?.line ?? null,
              total_lines: content.lines.length,
              lines,
              next_line:
                end < content.lines.length && lines.length ? end + 1 : null,
            };
          } catch (error) {
            if (!n?.excerpt) throw error;
            const previewStart = n.line ?? 1,
              preview = n.excerpt.split("\n");
            const from = Math.max(previewStart, start),
              lines = preview
                .slice(from - previewStart, from - previewStart + a.lines)
                .map((text, i) => ({ line: from + i, text }));
            result = {
              path: relative,
              source: "saved_symbol_preview",
              incomplete: true,
              reason: (error as Error).message,
              available_start_line: previewStart,
              available_end_line: previewStart + preview.length - 1,
              lines,
              note: "Only the saved scan-time excerpt is available; this is not the complete file or necessarily the complete symbol.",
            };
          }
          break;
        }
        case "search_source": {
          const query = a.case_sensitive ? a.query : a.query.toLowerCase(),
            matches: Record<string, any>[] = [],
            skipped: { path: string; reason: string }[] = [];
          const files = [...this.files.values()].filter(
            (f) =>
              !a.path_contains ||
              f.path.toLowerCase().includes(a.path_contains.toLowerCase()),
          );
          let examined = 0,
            capped = false;
          if (this.root) {
            for (const file of files.slice(0, a.max_files)) {
              examined++;
              try {
                const content = await this.textFile(file.path);
                for (let i = 0; i < content.lines.length; i++) {
                  const text = content.lines[i],
                    column = (
                      a.case_sensitive ? text : text.toLowerCase()
                    ).indexOf(query);
                  if (column < 0) continue;
                  if (matches.length >= a.limit) {
                    capped = true;
                    break;
                  }
                  matches.push({
                    path: file.path,
                    line: i + 1,
                    column: column + 1,
                    text: text.slice(Math.max(0, column - 100), column + 300),
                    source_newer_than_graph: content.newer,
                  });
                }
              } catch (e) {
                skipped.push({ path: file.path, reason: (e as Error).message });
              }
              if (capped) break;
            }
          } else {
            const allowed = new Set(
                files.slice(0, a.max_files).map((f) => f.path),
              ),
              seen = new Set<string>();
            examined = allowed.size;
            outer: for (const n of this.map.nodes)
              if (allowed.has(n.path) && n.excerpt) {
                const lines = n.excerpt.split("\n");
                for (let i = 0; i < lines.length; i++) {
                  const column = (
                      a.case_sensitive ? lines[i] : lines[i].toLowerCase()
                    ).indexOf(query),
                    line = (n.line ?? 1) + i,
                    key = `${n.path}:${line}`;
                  if (column < 0 || seen.has(key)) continue;
                  seen.add(key);
                  if (matches.length >= a.limit) {
                    capped = true;
                    break outer;
                  }
                  matches.push({
                    path: n.path,
                    line,
                    column: column + 1,
                    text: lines[i].slice(
                      Math.max(0, column - 100),
                      column + 300,
                    ),
                    node_id: n.id,
                  });
                }
              }
          }
          result = {
            results: matches,
            examined_files: examined,
            total_candidate_files: files.length,
            source: this.root ? "current_local_files" : "saved_symbol_previews",
            incomplete:
              capped ||
              examined < files.length ||
              skipped.length > 0 ||
              !this.root,
            result_limit_reached: capped,
            skipped: skipped.slice(0, 12),
            skipped_count: skipped.length,
            note: "Literal text search. A capped or preview-only search does not establish that other matches are absent.",
          };
          break;
        }
        case "get_diagnostics": {
          if (a.node_id) this.requireNode(a.node_id);
          const matches = this.map.issues.filter(
            (i) =>
              a.kinds.includes(i.kind) &&
              (!a.node_id || i.source === a.node_id) &&
              (!a.path_contains ||
                i.path.toLowerCase().includes(a.path_contains.toLowerCase())),
          );
          result = this.page(matches, a);
          break;
        }
        case "get_view":
          result = await view({ action: "inspect" });
          break;
        case "control_view": {
          if (a.node_id) this.requireNode(a.node_id);
          for (const id of a.node_ids ?? []) this.requireNode(id);
          const { project_id: _project, ...command } = a;
          result = await view(command as RemoteViewCommand);
          break;
        }
      }
    const output = { project_id: this.id, ...result! };
    if (JSON.stringify(output).length > 120000)
      throw new Error(
        "Result is too large. Narrow the search, use fewer nodes, or reduce limit/lines.",
      );
    return output;
  }
}
