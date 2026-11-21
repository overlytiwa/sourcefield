import type { CodeMap, MapEdge } from "../../shared/types";
import type {
  ArchitectureRule,
  ChangeReport,
  FeatureEntry,
  ImpactItem,
  Observation,
} from "../../shared/workbench";
const testPath = (p: string) =>
  /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|[._](?:test|spec)\.|Test\.(?:kt|java|swift)$/.test(
    p,
  );
export function impact(
  map: CodeMap,
  seeds: string[],
  max = 500,
): { items: ImpactItem[]; capped: boolean } {
  const ids = new Map(map.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, MapEdge[]>();
  for (const e of map.edges)
    if (
      ["calls", "references", "imports", "inherits", "dispatches"].includes(
        e.kind,
      )
    ) {
      const list = incoming.get(e.target) ?? [];
      list.push(e);
      incoming.set(e.target, list);
    }
  const queue = seeds
    .filter((id) => ids.has(id))
    .slice(0, max)
    .map((id) => ({ id, via: [] as string[] }));
  const seen = new Set(queue.map((q) => q.id));
  const items: ImpactItem[] = [];
  let capped = seeds.length > max;
  for (let at = 0; at < queue.length; at++) {
    const item = queue[at];
    for (const e of incoming.get(item.id) ?? []) {
      if (seen.has(e.source)) continue;
      if (seen.size >= max) {
        capped = true;
        continue;
      }
      seen.add(e.source);
      const n = ids.get(e.source)!;
      const via = [...item.via, e.id];
      items.push({
        node_id: n.id,
        via,
        reason: `${n.name} ${e.kind} ${ids.get(e.target)!.name}`,
        test: testPath(n.path),
        entry: !!map.features?.some((f) => f.node_id === n.id),
      });
      queue.push({ id: n.id, via });
    }
  }
  return { items, capped };
}
export function compareMaps(
  before: CodeMap,
  after: CodeMap,
  files: ChangeReport["files"],
  base: string,
): ChangeReport {
  const old = new Map(before.nodes.map((n) => [n.id, n])),
    next = new Map(after.nodes.map((n) => [n.id, n]));
  const paths = new Set(files.map((f) => f.path));
  const changed = after.nodes
    .filter(
      (n) =>
        paths.has(n.path) &&
        (n.kind === "file" ||
          !old.has(n.id) ||
          old.get(n.id)!.fingerprint !== n.fingerprint),
    )
    .map((n) => n.id);
  const removed = before.nodes
    .filter((n) => paths.has(n.path) && !next.has(n.id))
    .map((n) => ({ name: n.name, path: n.path }));
  // Removed targets still contribute their old callers to the impact review.
  const removedIds = before.nodes
    .filter((n) => paths.has(n.path) && !next.has(n.id))
    .map((n) => n.id);
  const previousImpact = impact(before, removedIds).items.filter((i) =>
    next.has(i.node_id),
  );
  const result = impact(after, changed);
  const seen = new Set(result.items.map((i) => i.node_id));
  for (const item of previousImpact)
    if (!seen.has(item.node_id)) {
      result.items.push({
        ...item,
        reason: item.reason + " (relationship existed in the base revision)",
      });
      seen.add(item.node_id);
    }
  const edgeKey = (e: MapEdge) => `${e.source}|${e.target}|${e.kind}`;
  const was = new Set(before.edges.map(edgeKey)),
    now = new Set(after.edges.map(edgeKey));
  const compact = (e: MapEdge, map: CodeMap) => {
    const nodes = map === before ? old : next;
    return {
      source: `${nodes.get(e.source)?.path}:${nodes.get(e.source)?.name}`,
      target: `${nodes.get(e.target)?.path}:${nodes.get(e.target)?.name}`,
      kind: e.kind,
    };
  };
  return {
    base,
    files,
    changed,
    removed,
    impacted: result.items.slice(0, 500),
    addedEdges: after.edges
      .filter((e) => e.kind !== "contains" && !was.has(edgeKey(e)))
      .slice(0, 200)
      .map((e) => compact(e, after)),
    removedEdges: before.edges
      .filter((e) => e.kind !== "contains" && !now.has(edgeKey(e)))
      .slice(0, 200)
      .map((e) => compact(e, before)),
    capped: result.capped || result.items.length > 500,
    note: "Potential impact from resolved relationships, not a prediction of failures. Unresolved/dynamic relationships and scan limits can hide consumers. Deleted-symbol paths may refer to base-revision edges.",
  };
}
export function architecture(map: CodeMap, rules: ArchitectureRule[]) {
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const violations = map.edges.flatMap((e) =>
    rules
      .filter(
        (r) =>
          (r.kind === "all" || r.kind === e.kind) &&
          nodes.get(e.source)!.path.startsWith(r.from) &&
          nodes.get(e.target)!.path.startsWith(r.to),
      )
      .map((r) => ({
        rule: r.title,
        edge_id: e.id,
        source: e.source,
        target: e.target,
        path: e.path,
        line: e.line,
      })),
  );
  // File import SCCs; symbol reference cycles are intentionally not architectural cycles.
  const adjacency = new Map<string, string[]>();
  for (const e of map.edges)
    if (e.kind === "imports") {
      const list = adjacency.get(e.source) ?? [];
      list.push(e.target);
      adjacency.set(e.source, list);
    }
  const cycles: string[][] = [];
  // Iterative Kosaraju avoids stack exhaustion on large repositories.
  const seen = new Set<string>(),
    order: string[] = [],
    reverse = new Map<string, string[]>();
  for (const [a, list] of adjacency)
    for (const b of list) {
      const r = reverse.get(b) ?? [];
      r.push(a);
      reverse.set(b, r);
    }
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const frames: { id: string; exit: boolean }[] = [
      { id: start, exit: false },
    ];
    while (frames.length) {
      const f = frames.pop()!;
      if (f.exit) {
        order.push(f.id);
        continue;
      }
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      frames.push({ id: f.id, exit: true });
      for (const id of adjacency.get(f.id) ?? [])
        if (!seen.has(id)) frames.push({ id, exit: false });
    }
  }
  seen.clear();
  for (const start of order.reverse()) {
    if (seen.has(start)) continue;
    const group: string[] = [],
      pending = [start];
    seen.add(start);
    while (pending.length) {
      const id = pending.pop()!;
      group.push(id);
      for (const p of reverse.get(id) ?? [])
        if (!seen.has(p)) {
          seen.add(p);
          pending.push(p);
        }
    }
    if (group.length > 1) cycles.push(group);
  }
  return {
    violations: violations.slice(0, 500),
    cycles: cycles.slice(0, 100),
    capped: violations.length > 500 || cycles.length > 100,
  };
}
export function mapObservations(
  map: CodeMap,
  text: string,
  format: "stack" | "coverage" | "trace",
): { observations: Observation[]; unmatched: string[] } {
  if (text.length > 8 * 1024 * 1024)
    throw new Error("Import exceeds the 8 MiB limit.");
  const observations: Observation[] = [],
    unmatched: string[] = [];
  const locate = (raw: string, line?: number, name?: string) => {
    const clean = raw.replace(/\\/g, "/").replace(/^file:\/\//, "");
    let files = map.nodes.filter(
      (n) =>
        n.kind === "file" && (clean === n.path || clean.endsWith("/" + n.path)),
    );
    if (!files.length && !clean.includes("/"))
      files = map.nodes.filter(
        (n) => n.kind === "file" && n.path.split("/").at(-1) === clean,
      );
    if (files.length !== 1) return undefined;
    const symbols = map.nodes
      .filter(
        (n) =>
          n.path === files[0].path &&
          n.line &&
          line &&
          n.line <= line &&
          (n.endLine ?? n.line) >= line &&
          n.kind !== "file",
      )
      .sort((a, b) => a.endLine! - a.line! - (b.endLine! - b.line!));
    return symbols[0] ?? files[0];
  };
  const add = (
    path: string,
    line: number | undefined,
    label: string,
    detail: string,
    hits?: number,
  ) => {
    const node = locate(path, line);
    if (observations.length >= 20000)
      throw new Error(
        "Too many mapped observations. Narrow the imported recording.",
      );
    if (node)
      observations.push({
        node_id: node.id,
        label,
        source: format,
        detail: detail.slice(0, 1000),
        hits,
      });
    else if (unmatched.length < 100) unmatched.push(detail.slice(0, 300));
  };
  if (format === "stack")
    for (const line of text.split("\n")) {
      const m =
        line.match(
          /(?:\(|\s|^)((?:[A-Za-z]:)?[^\s()]+\.[a-zA-Z]+):(\d+)(?::\d+)?\)?/,
        ) ?? line.match(/File "([^"]+)", line (\d+)/);
      if (m) add(m[1], Number(m[2]), "Stack frame", line);
    }
  if (format === "coverage") {
    let file = "";
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("SF:")) file = line.slice(3);
      const m = line.match(/^DA:(\d+),(\d+)/);
      if (file && m)
        add(
          file,
          Number(m[1]),
          Number(m[2]) ? "Covered" : "Not covered",
          `${file}:${m[1]} — ${m[2]} hits`,
          Number(m[2]),
        );
    }
  }
  if (format === "trace") {
    const json = JSON.parse(text);
    const spans: any[] = Array.isArray(json)
      ? json
      : (json.resourceSpans?.flatMap((r: any) =>
          (r.scopeSpans ?? r.instrumentationLibrarySpans ?? []).flatMap(
            (s: any) => s.spans ?? [],
          ),
        ) ??
        json.spans ??
        []);
    if (!Array.isArray(spans) || spans.length > 50000)
      throw new Error(
        "Expected OTLP JSON resourceSpans, spans, or an array (up to 50,000 spans).",
      );
    for (const span of spans) {
      const attrs = Array.isArray(span.attributes)
        ? Object.fromEntries(
            span.attributes.map((a: any) => [
              a.key,
              a.value?.stringValue ?? a.value?.intValue,
            ]),
          )
        : (span.attributes ?? {});
      const file = attrs["code.file.path"] ?? attrs["code.filepath"];
      if (file)
        add(
          String(file),
          Number(attrs["code.line.number"] ?? attrs["code.lineno"]) ||
            undefined,
          String(span.name ?? "Span"),
          JSON.stringify({
            name: span.name,
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            status: span.status,
          }).slice(0, 1000),
        );
      else if (unmatched.length < 100)
        unmatched.push(`${span.name ?? "Span"}: source file attribute missing`);
    }
  }
  if (observations.length > 20000)
    throw new Error(
      "Too many mapped observations. Narrow the imported recording.",
    );
  return { observations, unmatched };
}
