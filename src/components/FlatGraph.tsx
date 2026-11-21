import { useMemo } from "react";
import type { CodeMap } from "../../shared/types";
export function FlatGraph({
  map,
  selected,
  onSelect,
}: {
  map: CodeMap;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { nodes, edges, width, height } = useMemo(() => {
    const nodes = map.nodes.slice(0, 160),
      ids = new Set(nodes.map((n) => n.id)),
      edges = map.edges
        .filter(
          (e) =>
            ids.has(e.source) && ids.has(e.target) && e.kind !== "contains",
        )
        .slice(0, 500);
    const incoming = new Map<string, number>();
    for (const n of nodes) incoming.set(n.id, 0);
    for (const e of edges)
      incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    const layers = new Map<string, number>(),
      queue = nodes.filter((n) => !incoming.get(n.id)).map((n) => n.id);
    for (const id of queue) layers.set(id, 0);
    const out = new Map<string, typeof edges>();
    for (const e of edges) {
      const list = out.get(e.source) ?? [];
      list.push(e);
      out.set(e.source, list);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const e of out.get(id) ?? []) {
        layers.set(
          e.target,
          Math.max(layers.get(e.target) ?? 0, (layers.get(id) ?? 0) + 1),
        );
        incoming.set(e.target, incoming.get(e.target)! - 1);
        if (!incoming.get(e.target)) queue.push(e.target);
      }
    }
    const rows = new Map<number, number>();
    const placed = nodes.map((n) => {
      const layer = Math.min(layers.get(n.id) ?? 0, 8),
        row = rows.get(layer) ?? 0;
      rows.set(layer, row + 1);
      return { ...n, x: 30 + layer * 270, y: 30 + row * 90 };
    });
    return {
      nodes: placed,
      edges,
      width: Math.max(650, ...placed.map((n) => n.x + 250)),
      height: Math.max(500, ...placed.map((n) => n.y + 80)),
    };
  }, [map]);
  const index = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="flat-graph" aria-label="Directed relationship map">
      <p>
        Arrows point from source to target. Cycles share a column. Showing{" "}
        {nodes.length} nodes
        {map.nodes.length > 160 ? " of " + map.nodes.length : ""}.
      </p>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Dependency relationships"
      >
        <defs>
          <marker
            id="edge-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L7,3 z" fill="#b8793f" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = index.get(e.source)!,
            b = index.get(e.target)!;
          return (
            <g key={e.id}>
              <path
                d={`M${a.x + 215},${a.y + 24} C${a.x + 250},${a.y + 24} ${b.x - 35},${b.y + 24} ${b.x},${b.y + 24}`}
                fill="none"
                stroke={
                  a.id === selected || b.id === selected ? "#ffb05d" : "#624729"
                }
                markerEnd="url(#edge-arrow)"
              />
              <text
                x={(a.x + 215 + b.x) / 2}
                y={(a.y + b.y) / 2 + 18}
                fill="#ab977a"
                fontSize="10"
              >
                {e.kind}
              </text>
              <title>{e.evidence ?? e.kind}</title>
            </g>
          );
        })}
        {nodes.map((n) => (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${n.kind} ${n.name}`}
            onClick={() => onSelect(n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(n.id);
              }
            }}
          >
            <rect
              x={n.x}
              y={n.y}
              width="215"
              height="52"
              rx="8"
              fill="#13110e"
              stroke={n.id === selected ? "#ffb05d" : "#55432e"}
            />
            <text x={n.x + 10} y={n.y + 21} fill="#ead9bf" fontSize="12">
              {n.name.slice(0, 28)}
            </text>
            <text x={n.x + 10} y={n.y + 39} fill="#9a8a73" fontSize="10">
              {n.kind} · {n.path.slice(-28)}
            </text>
            <title>
              {n.path}:{n.line}
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}
