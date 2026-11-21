import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "chokidar";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { CodeMap } from "../../shared/types";
import {
  portableSchema,
  emptyWorkbench,
  resolveAnchor,
} from "../../shared/workbench";
import type {
  Activity,
  PortableWorkbench,
  WorkbenchState,
} from "../../shared/workbench";
import { architecture, impact, mapObservations } from "./graph";
import { coChanges, changedFiles } from "./git";
import { background } from "../tasks";
import { excludedFolders } from "../analyzer/folder-policy";

export class Workbench {
  data: PortableWorkbench;
  activity: Activity[] = [];
  edits = new Set<string>();
  observedEdits = new Set<string>();
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private saveQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private comparisons = new Map<
    string,
    { status: string; result?: unknown; error?: string }
  >();
  private constructor(
    public map: CodeMap,
    readonly root: string | null,
    readonly file: string,
    readonly notify: (value: { paths: string[]; watching: boolean }) => void,
  ) {
    this.data = map.workbench ?? emptyWorkbench();
  }
  static async open(
    map: CodeMap,
    root: string | null,
    directory: string,
    notify: (value: { paths: string[]; watching: boolean }) => void,
  ) {
    const key = createHash("sha256")
      .update(root ?? "offline:" + map.createdAt + ":" + map.project.name)
      .digest("hex");
    const service = new Workbench(
      map,
      root,
      path.join(directory, "projects", key + ".json"),
      notify,
    );
    try {
      const stat = await fs.stat(service.file);
      if (stat.size < 5 * 1024 * 1024) {
        const raw = JSON.parse(await fs.readFile(service.file, "utf8"));
        service.data = portableSchema.parse(raw.data) as PortableWorkbench;
        service.observedEdits = new Set(
          Array.isArray(raw.observedEdits)
            ? raw.observedEdits
                .filter((p: unknown) => typeof p === "string")
                .slice(-1000)
            : [],
        );
        service.activity = Array.isArray(raw.activity)
          ? raw.activity.slice(-300)
          : [];
      }
    } catch {
      /* First visit uses embedded portable state. */
    }
    service.startWatch();
    return service;
  }
  async close() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    await this.watcher?.close();
    await this.saveQueue.catch(() => {});
  }
  replace(map: CodeMap) {
    this.map = map;
    this.edits.clear();
    this.generation++;
    this.notify({ paths: [], watching: !!this.watcher });
  }
  startWatch() {
    if (!this.root || this.watcher) return;
    const ignored = (file: string) => {
      const relative = path
        .relative(this.root!, file)
        .split(path.sep)
        .join("/");
      return (
        relative
          .split("/")
          .some(
            (p) =>
              excludedFolders.has(p) ||
              [
                "node_modules",
                ".venv",
                "venv",
                "vendor",
                ".sourcefield",
              ].includes(p),
          ) ||
        /^\.env(?:\.|$)/.test(path.basename(file)) ||
        /\.(?:pem|key|p12|pfx)$/i.test(file)
      );
    };
    try {
      this.watcher = watch(this.root, {
        ignored,
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
      });
      this.watcher.on("all", (_event, file) => {
        if (this.disposed) return;
        const relative = path
          .relative(this.root!, file)
          .split(path.sep)
          .join("/");
        this.edits.add(relative);
        this.observedEdits.add(relative);
        for (const set of [this.edits, this.observedEdits])
          if (set.size > 1000) set.delete(set.values().next().value!);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.notify({ paths: [...this.edits], watching: true });
          void this.persist().catch(() => {});
        }, 500);
      });
      this.watcher.on("error", () => {
        void this.watcher?.close();
        this.watcher = undefined;
        this.notify({ paths: [...this.edits], watching: false });
      });
    } catch {
      this.notify({ paths: [], watching: false });
    }
  }
  private persist() {
    const content = JSON.stringify({
      data: this.data,
      activity: this.activity,
      observedEdits: [...this.observedEdits],
    });
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temp = this.file + ".tmp";
        await fs.writeFile(temp, content, { mode: 0o600 });
        await fs.rename(temp, this.file);
      });
    return this.saveQueue;
  }
  record(tool: string, args: any, ok: boolean, result?: any) {
    const node_ids = [
      ...new Set<string>([
        ...(args.node_id ? [args.node_id] : []),
        ...(Array.isArray(args.node_ids) ? args.node_ids : []),
        ...(result?.results ?? []).flatMap((r: any) =>
          r.node_id ? [r.node_id] : r.other?.node_id ? [r.other.node_id] : [],
        ),
      ]),
    ].slice(0, 100);
    const paths = new Set<string>(args.path ? [args.path] : []);
    for (const id of node_ids) {
      const node = this.map.nodes.find((n) => n.id === id);
      if (node) paths.add(node.path);
    }
    const ranges =
      result?.source === "current_local_file"
        ? [
            {
              path: result.path,
              start: result.start_line,
              end: result.end_line,
            },
          ]
        : undefined;
    const edge_ids = (result?.edges ?? result?.results ?? [])
      .flatMap((e: any) => (e.edge_id ? [e.edge_id] : []))
      .slice(0, 100);
    this.activity.push({
      at: new Date().toISOString(),
      tool,
      node_ids,
      paths: [...paths],
      ok,
      ranges,
      edge_ids,
    });
    this.activity = this.activity.slice(-300);
    void this.persist().catch(() => {});
  }
  async execute(action: string, args: Record<string, any> = {}): Promise<any> {
    if (this.disposed) throw new Error("The active project changed.");
    const generation = this.generation;
    if (Buffer.byteLength(JSON.stringify(args)) > 10 * 1024 * 1024)
      throw new Error("Request is too large.");
    const ids = new Set(this.map.nodes.map((n) => n.id));
    if (args.node_id && !ids.has(args.node_id))
      throw new Error("Unknown node. Search the current project again.");
    switch (action) {
      case "start-comparison": {
        const id = randomUUID();
        if (this.comparisons.size >= 5)
          this.comparisons.delete(this.comparisons.keys().next().value!);
        this.comparisons.set(id, { status: "running" });
        void this.execute("changes", args).then(
          (result) => this.comparisons.set(id, { status: "complete", result }),
          (error) =>
            this.comparisons.set(id, {
              status: "failed",
              error: error.message,
            }),
        );
        return {
          job_id: id,
          status: "running",
          note: "Poll get_comparison with this job_id. The desktop remains responsive.",
        };
      }
      case "comparison": {
        const job = this.comparisons.get(args.job_id);
        if (!job)
          throw new Error("Unknown comparison job. Start a comparison again.");
        return { ...job, job_id: args.job_id };
      }

      case "state":
        return {
          data: this.data,
          activity: this.activity,
          edits: [...this.observedEdits],
          stale: !!this.edits.size,
          watching: !!this.watcher,
        } satisfies WorkbenchState;
      case "save": {
        const data = portableSchema.parse(args.data) as PortableWorkbench;
        this.data = data;
        await this.persist();
        return this.execute("state");
      }
      case "features":
        return {
          entries: this.map.features ?? [],
          note: "Entries are detected from explicit syntax. Dynamic registrations may be absent.",
        };
      case "impact":
        return impact(
          this.map,
          Array.isArray(args.node_ids)
            ? args.node_ids
                .filter((id: unknown) => typeof id === "string")
                .slice(0, 200)
            : [args.node_id],
        );
      case "changes": {
        if (!this.root)
          throw new Error("Open the project folder to compare Git revisions.");
        if (this.edits.size)
          throw new Error("Refresh the map before comparing changes.");
        const result = await background({
          task: "changes",
          map: this.map,
          root: this.root,
          rules: this.data.rules,
          ref: typeof args.base === "string" ? args.base : "HEAD",
        });
        if (generation !== this.generation || this.edits.size || this.disposed)
          throw new Error(
            "Source changed during comparison. Refresh and compare again.",
          );
        return result;
      }
      case "architecture":
        return architecture(this.map, this.data.rules);
      case "coupling":
        if (!this.root)
          throw new Error("Git history requires a local project.");
        return coChanges(
          this.root,
          Array.isArray(args.paths) ? args.paths.slice(0, 100) : [],
        );
      case "observations":
        if (
          !["stack", "coverage", "trace"].includes(args.format) ||
          typeof args.text !== "string"
        )
          throw new Error("Choose stack, coverage or trace and provide text.");
        return mapObservations(this.map, args.text, args.format);
      case "tour": {
        const tour = this.data.tours.find((t) => t.id === args.id);
        if (!tour) throw new Error("Choose a saved tour.");
        const offset = args.offset ?? 0,
          limit = args.limit ?? 15;
        return {
          title: tour.title,
          total: tour.steps.length,
          steps: tour.steps.slice(offset, offset + limit).map((step) => ({
            ...step,
            ...resolveAnchor(this.map, step.anchor),
          })),
          next_offset:
            offset + limit < tour.steps.length ? offset + limit : null,
        };
      }
      case "context": {
        const work = this.data.investigations.find((w) => w.id === args.id);
        if (!work) throw new Error("Choose a saved investigation.");
        const resolved = work.nodes.map((anchor) => ({
          anchor,
          ...resolveAnchor(this.map, anchor),
        }));
        const selected = new Set(
          resolved.flatMap((r) => (r.node ? [r.node.id] : [])),
        );
        return {
          title: work.title,
          notes: work.notes,
          questions: work.questions,
          nodes: resolved.map((r) => ({
            anchor: r.anchor,
            status: r.status,
            node: r.node
              ? {
                  id: r.node.id,
                  path: r.node.path,
                  line: r.node.line,
                  name: r.node.name,
                  signature: r.node.signature,
                  preview: r.node.excerpt,
                }
              : null,
          })),
          relationships: this.map.edges
            .filter((e) => selected.has(e.source) && selected.has(e.target))
            .slice(0, 200),
          suggestions: impact(this.map, [...selected], 100),
          note: "Previews are scan-time excerpts. Sourcefield does not claim that a queried symbol was understood.",
        };
      }
      case "git-status":
        if (!this.root) throw new Error("Open a local project.");
        return changedFiles(this.root);
      default:
        throw new Error("Unknown workbench operation.");
    }
  }
}
