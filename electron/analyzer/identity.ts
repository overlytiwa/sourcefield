import { createHash } from "node:crypto";
import type { CodeMap } from "../../shared/types";
import { stableId } from "./graph";
/** Semantic identities survive text inserted before a declaration. Duplicate sibling
 * names use declaration order; ambiguous renames deliberately become new symbols. */
export function stabilizeGraph(map: CodeMap) {
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const identities = new Map<string, string>(),
    counts = new Map<string, number>();
  function identity(id: string): string {
    if (identities.has(id)) return identities.get(id)!;
    const n = nodes.get(id)!;
    const parent = n.parent ? identity(n.parent) : n.path;
    const key =
      n.kind === "file" || n.kind === "folder"
        ? `${n.kind}:${n.path}`
        : `${parent}:${n.kind}:${n.name}`;
    const ordinal = counts.get(key) ?? 0;
    counts.set(key, ordinal + 1);
    const value = `${n.kind === "file" ? "f" : n.kind === "folder" ? "d" : "s"}:${stableId(key + ":" + ordinal)}`;
    identities.set(id, value);
    return value;
  }
  for (const n of map.nodes) identity(n.id);
  for (const n of map.nodes) {
    const old = n.id;
    n.id = identities.get(old)!;
    if (n.parent) n.parent = identities.get(n.parent);
    n.fingerprint ??= createHash("sha256")
      .update(n.excerpt ?? n.signature ?? n.name)
      .digest("hex");
  }
  for (const e of map.edges) {
    e.source = identities.get(e.source)!;
    e.target = identities.get(e.target)!;
    e.id = stableId(`${e.source}|${e.target}|${e.kind}`);
  }
  for (const f of map.features ?? []) {
    f.node_id = identities.get(f.node_id)!;
    f.target_ids = f.target_ids
      .map((id) => identities.get(id)!)
      .filter(Boolean);
  }
  for (const i of map.issues) if (i.source) i.source = identities.get(i.source);
}
