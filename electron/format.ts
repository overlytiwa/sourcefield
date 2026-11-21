import { gzipSync, gunzipSync } from "node:zlib";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CodeMap, ViewState } from "../shared/types";
import { portableSchema } from "../shared/workbench";
import { EDGE_KINDS } from "../shared/types";

const MAGIC = Buffer.from("SOURCEFIELD\x00\x01\n", "binary");
const MAX_BYTES = 256 * 1024 * 1024;
const nodeKinds = new Set([
  "folder",
  "file",
  "class",
  "function",
  "method",
  "variable",
  "parameter",
  "property",
  "interface",
  "type",
  "enum",
  "namespace",
  "import",
]);
const issueKinds = new Set([
  "unsupported",
  "unresolved",
  "external",
  "parse",
  "skipped",
  "limit",
]);
const isRecord = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 10000) =>
  typeof v === "string" && v.length <= max;
const vector = (v: unknown) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every(
    (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e8,
  );
const line = (v: unknown) =>
  v === undefined || (Number.isInteger(v) && Number(v) > 0 && Number(v) < 1e9);
const safePath = (v: unknown) =>
  text(v) &&
  !String(v).startsWith("/") &&
  !/^[A-Za-z]:/.test(String(v)) &&
  !String(v).split(/[\\/]/).includes("..");

export function validateView(value: unknown, ids: Set<string>): ViewState {
  if (
    !isRecord(value) ||
    !vector(value.position) ||
    !vector(value.target) ||
    !(
      value.selected === null ||
      (typeof value.selected === "string" && ids.has(value.selected))
    ) ||
    !Array.isArray(value.visibleEdges) ||
    value.visibleEdges.length > 7 ||
    !value.visibleEdges.every((k: any) => EDGE_KINDS.includes(k)) ||
    typeof value.labels !== "boolean"
  )
    throw new Error("Invalid saved camera view.");
  return {
    position: [...value.position] as [number, number, number],
    target: [...value.target] as [number, number, number],
    selected: value.selected,
    visibleEdges: [...new Set(value.visibleEdges)] as ViewState["visibleEdges"],
    labels: value.labels,
  };
}
export function validateMap(value: unknown): CodeMap {
  if (!isRecord(value) || value.format !== "sourcefield.code-map")
    throw new Error("This is not an Sourcefield map.");
  if (value.version !== 1)
    throw new Error(
      `Unsupported map version ${String(value.version)}. This app supports version 1.`,
    );
  if (
    !text(value.createdAt, 100) ||
    !isRecord(value.project) ||
    !text(value.project.name, 1000) ||
    !["files", "analyzed", "ignored"].every(
      (k) => Number.isInteger(value.project[k]) && value.project[k] >= 0,
    ) ||
    !Array.isArray(value.project.languages) ||
    value.project.languages.length > 100 ||
    !value.project.languages.every((l: unknown) => text(l, 100))
  )
    throw new Error("Invalid project metadata.");
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length > 220000 ||
    !Array.isArray(value.edges) ||
    value.edges.length > 1200000 ||
    !Array.isArray(value.issues) ||
    value.issues.length > 200002
  )
    throw new Error("The map exceeds the supported graph limits.");
  if (
    !isRecord(value.layout) ||
    value.layout.algorithm !== "spherical-graph-v1" ||
    !Number.isFinite(value.layout.seed) ||
    !Number.isFinite(value.layout.radius) ||
    value.layout.radius <= 0 ||
    value.layout.radius > 1e7
  )
    throw new Error("Invalid map layout.");
  if (value.scan !== undefined) {
    const s = value.scan;
    if (
      !isRecord(s) ||
      typeof s.includeDependencies !== "boolean" ||
      !Number.isSafeInteger(s.excludedDependencyCount) ||
      s.excludedDependencyCount < 0 ||
      !Array.isArray(s.excludedDependencies) ||
      s.excludedDependencies.length > 1000 ||
      s.excludedDependencies.length > s.excludedDependencyCount ||
      !s.excludedDependencies.every(
        (d: unknown) => isRecord(d) && safePath(d.path) && text(d.reason, 500),
      )
    )
      throw new Error("Invalid scan scope.");
  }
  if (value.workbench !== undefined)
    value.workbench = portableSchema.parse(value.workbench);
  if (
    value.features !== undefined &&
    (!Array.isArray(value.features) ||
      value.features.length > 10000 ||
      value.features.some(
        (f: any) =>
          !isRecord(f) ||
          !text(f.id, 300) ||
          !text(f.node_id, 300) ||
          !text(f.name, 1000) ||
          !text(f.kind, 100) ||
          !safePath(f.path) ||
          !line(f.line) ||
          !text(f.evidence, 1000) ||
          !Array.isArray(f.target_ids) ||
          f.target_ids.length > 1000 ||
          f.target_ids.some((id: any) => !text(id, 300)),
      ))
  )
    throw new Error("Invalid feature entries.");
  const ids = new Set<string>();
  const parents = new Map<string, string>();
  for (const n of value.nodes) {
    if (
      !isRecord(n) ||
      !text(n.id, 300) ||
      ids.has(n.id) ||
      !text(n.name, 10000) ||
      !nodeKinds.has(n.kind) ||
      !safePath(n.path) ||
      !vector(n.position) ||
      !Number.isFinite(n.degree) ||
      n.degree < 0 ||
      !line(n.line) ||
      !line(n.column) ||
      !line(n.endLine) ||
      (n.parent !== undefined && !text(n.parent, 300)) ||
      (n.excerpt !== undefined && !text(n.excerpt, 20000)) ||
      (n.fingerprint !== undefined && !text(n.fingerprint, 100)) ||
      (n.signature !== undefined && !text(n.signature, 10000)) ||
      (n.language !== undefined && !text(n.language, 100)) ||
      (n.status !== undefined &&
        !["analyzed", "partial", "unsupported", "skipped"].includes(n.status))
    )
      throw new Error("Invalid node in map.");
    ids.add(n.id);
    if (n.parent) parents.set(n.id, n.parent);
  }
  if (
    value.features?.some(
      (f: any) =>
        !ids.has(f.node_id) || f.target_ids.some((id: string) => !ids.has(id)),
    )
  )
    throw new Error("Feature has a missing node.");
  const visited = new Set<string>();
  for (const [id, parent] of parents) {
    if (!ids.has(parent)) throw new Error("Map has a missing parent.");
    let current: string | undefined = id;
    const trail = new Set<string>();
    while (current && !visited.has(current)) {
      if (trail.has(current))
        throw new Error("Map contains a cyclic hierarchy.");
      trail.add(current);
      current = parents.get(current);
    }
    for (const item of trail) visited.add(item);
  }
  const edgeIds = new Set<string>();
  for (const e of value.edges) {
    if (
      !isRecord(e) ||
      !text(e.id, 300) ||
      edgeIds.has(e.id) ||
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      !EDGE_KINDS.includes(e.kind) ||
      (e.evidence !== undefined && !text(e.evidence, 1000)) ||
      !Number.isInteger(e.count) ||
      e.count < 1 ||
      !line(e.line) ||
      (e.path !== undefined && !safePath(e.path)) ||
      (e.locations !== undefined &&
        (!Array.isArray(e.locations) ||
          e.locations.length > 1000 ||
          !e.locations.every(
            (l: any) =>
              isRecord(l) &&
              safePath(l.path) &&
              line(l.line) &&
              l.line !== undefined &&
              line(l.column),
          )))
    )
      throw new Error("Invalid connection in map.");
    edgeIds.add(e.id);
  }
  for (const i of value.issues)
    if (
      !isRecord(i) ||
      !issueKinds.has(i.kind) ||
      !safePath(i.path) ||
      !text(i.name, 10000) ||
      !text(i.reason, 20000) ||
      !line(i.line) ||
      (i.source != null && !ids.has(i.source)) ||
      (i.relationship != null && !EDGE_KINDS.includes(i.relationship))
    )
      throw new Error("Invalid diagnostic in map.");
  if (value.view) value.view = validateView(value.view, ids);
  return value as CodeMap;
}
export function encodeMap(map: CodeMap) {
  const raw = Buffer.from(JSON.stringify(validateMap(map)), "utf8");
  if (raw.length > MAX_BYTES)
    throw new Error("Map is larger than the 256 MiB format limit.");
  return Buffer.concat([MAGIC, gzipSync(raw, { level: 6 })]);
}
export function decodeMap(buffer: Buffer) {
  if (buffer.length > MAX_BYTES) throw new Error("Map file is too large.");
  if (
    buffer.length <= MAGIC.length ||
    !buffer.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error("Unrecognized Sourcefield map header.");
  let value: unknown;
  try {
    value = JSON.parse(
      gunzipSync(buffer.subarray(MAGIC.length), {
        maxOutputLength: MAX_BYTES,
      }).toString("utf8"),
    );
  } catch {
    throw new Error(
      "The map is damaged or exceeds the 256 MiB expansion limit.",
    );
  }
  return validateMap(value);
}
export async function readMap(file: string) {
  if ((await fs.stat(file)).size > MAX_BYTES)
    throw new Error("Map file is too large.");
  return decodeMap(await fs.readFile(file));
}
export async function writeMap(file: string, map: CodeMap) {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.tmp`,
  );
  try {
    await fs.writeFile(temp, encodeMap(map), { flag: "wx" });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}
