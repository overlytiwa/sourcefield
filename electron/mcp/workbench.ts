import type { Workbench } from "../workbench/service";
export const workbenchActions: Record<string, string> = {
  get_tour: "tour",
  get_investigation: "context",
  get_activity: "state",
  get_features: "features",
  get_impact: "impact",
  get_architecture: "architecture",
  compare_changes: "start-comparison",
  get_comparison: "comparison",
};
export async function queryWorkbench(
  service: Workbench,
  name: string,
  args: Record<string, any>,
) {
  const value = await service.execute(workbenchActions[name], args);
  if (name === "get_activity")
    return {
      investigations: value.data.investigations.map((w: any) => ({
        id: w.id,
        title: w.title,
        nodes: w.nodes.length,
      })),
      tours: value.data.tours.map((t: any) => ({
        id: t.id,
        title: t.title,
        steps: t.steps.length,
      })),
      activity: value.activity.slice(-20),
      edits: value.edits.slice(0, 100),
      stale: value.stale,
    };
  if (name === "get_features") {
    const entries = value.entries.filter((f: any) =>
      (f.name + " " + f.path).toLowerCase().includes(args.query.toLowerCase()),
    );
    return {
      entries: entries.slice(args.offset, args.offset + args.limit),
      total: entries.length,
      offset: args.offset,
      next_offset:
        args.offset + args.limit < entries.length
          ? args.offset + args.limit
          : null,
      note: value.note,
    };
  }
  if (name === "get_investigation")
    return {
      ...value,
      nodes: value.nodes.slice(0, args.limit),
      total_nodes: value.nodes.length,
      capped: value.nodes.length > args.limit,
    };
  return value;
}
