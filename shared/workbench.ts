import { z } from "zod";
import type { CodeMap, MapNode, ViewState } from "./types";
export const anchorSchema = z
  .object({
    id: z.string().max(300),
    path: z.string().max(1000),
    name: z.string().max(1000),
    kind: z.string().max(40),
    fingerprint: z.string().max(100).optional(),
  })
  .strict();
export const investigationSchema = z
  .object({
    id: z.string().max(100),
    title: z.string().min(1).max(200),
    nodes: z.array(anchorSchema).max(200),
    notes: z.string().max(30000),
    questions: z.string().max(10000),
    view: z
      .object({
        position: z.tuple([
          z.number().finite(),
          z.number().finite(),
          z.number().finite(),
        ]),
        target: z.tuple([
          z.number().finite(),
          z.number().finite(),
          z.number().finite(),
        ]),
        selected: z.string().max(300).nullable(),
        visibleEdges: z
          .array(
            z.enum([
              "contains",
              "imports",
              "exports",
              "calls",
              "inherits",
              "references",
              "dispatches",
            ]),
          )
          .max(7),
        labels: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const tourSchema = z
  .object({
    id: z.string().max(100),
    title: z.string().min(1).max(200),
    steps: z
      .array(
        z.object({ anchor: anchorSchema, note: z.string().max(5000) }).strict(),
      )
      .max(100),
  })
  .strict();
export const ruleSchema = z
  .object({
    id: z.string().max(100),
    title: z.string().min(1).max(200),
    from: z.string().min(1).max(300),
    to: z.string().min(1).max(300),
    kind: z.enum(["imports", "calls", "references", "inherits", "all"]),
  })
  .strict();
export const portableSchema = z
  .object({
    investigations: z.array(investigationSchema).max(100),
    tours: z.array(tourSchema).max(100),
    rules: z.array(ruleSchema).max(100),
  })
  .strict();
export type Anchor = z.infer<typeof anchorSchema>;
export type Investigation = Omit<
  z.infer<typeof investigationSchema>,
  "view"
> & { view?: ViewState };
export type Tour = z.infer<typeof tourSchema>;
export type ArchitectureRule = z.infer<typeof ruleSchema>;
export interface PortableWorkbench {
  investigations: Investigation[];
  tours: Tour[];
  rules: ArchitectureRule[];
}
export const emptyWorkbench = (): PortableWorkbench => ({
  investigations: [],
  tours: [],
  rules: [],
});
export const anchorFor = (n: MapNode): Anchor => ({
  id: n.id,
  path: n.path,
  name: n.name,
  kind: n.kind,
  fingerprint: n.fingerprint,
});
export function resolveAnchor(map: CodeMap, anchor: Anchor) {
  const node = map.nodes.find((n) => n.id === anchor.id);
  const candidates = node
    ? [node]
    : map.nodes.filter(
        (n) =>
          n.path === anchor.path &&
          n.name === anchor.name &&
          n.kind === anchor.kind,
      );
  const match = candidates.length === 1 ? candidates[0] : undefined;
  return {
    node: match,
    status: !match
      ? "missing"
      : anchor.fingerprint && match.fingerprint !== anchor.fingerprint
        ? "changed"
        : "current",
  };
}
export interface ImpactItem {
  node_id: string;
  via: string[];
  reason: string;
  test: boolean;
  entry: boolean;
}
export interface ChangeReport {
  base: string;
  files: { path: string; status: string }[];
  changed: string[];
  removed: { name: string; path: string }[];
  impacted: ImpactItem[];
  addedEdges: { source: string; target: string; kind: string }[];
  removedEdges: { source: string; target: string; kind: string }[];
  capped: boolean;
  note: string;
  architecture?: {
    new_cycles: string[][];
    introduced_violations: {
      rule: string;
      source: string;
      target: string;
      edge_id: string;
    }[];
  };
}
export interface FeatureEntry {
  id: string;
  node_id: string;
  name: string;
  kind: string;
  path: string;
  line: number;
  evidence: string;
  target_ids: string[];
}
export interface Activity {
  at: string;
  tool: string;
  node_ids: string[];
  paths: string[];
  ok: boolean;
  ranges?: { path: string; start: number; end: number | null }[];
  edge_ids?: string[];
}
export interface Observation {
  node_id: string;
  label: string;
  source: "stack" | "coverage" | "trace";
  detail: string;
  hits?: number;
}
export interface WorkbenchState {
  data: PortableWorkbench;
  activity: Activity[];
  edits: string[];
  stale: boolean;
  watching: boolean;
}
export interface WorkbenchAPI {
  refresh(): Promise<unknown>;
  workbench(action: string, args?: Record<string, unknown>): Promise<unknown>;
  onDirty(
    callback: (value: { paths: string[]; watching: boolean }) => void,
  ): () => void;
}
