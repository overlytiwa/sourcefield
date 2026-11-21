module.exports = function largeMap() {
  const nodes = Array.from({ length: 50000 }, (_, i) => ({
    id: `n${i}`,
    name: `node ${i}`,
    path: `module/${i}.ts`,
    kind: i % 1000 === 0 ? "folder" : i % 100 === 0 ? "file" : "function",
    degree: 8,
    position: [
      ((i % 100) - 50) * 2,
      ((Math.floor(i / 100) % 100) - 50) * 2,
      (Math.floor(i / 10000) - 2) * 30,
    ],
  }));
  const edges = Array.from({ length: 193000 }, (_, i) => ({
    id: `e${i}`,
    source: `n${i % nodes.length}`,
    target: `n${((i % nodes.length) + Math.floor(i / nodes.length) * 97 + 1) % nodes.length}`,
    kind: i % 7 === 0 ? "imports" : "calls",
    count: 1,
  }));
  return {
    format: "sourcefield.code-map",
    version: 1,
    createdAt: new Date().toISOString(),
    project: {
      name: "Large map fixture",
      files: 500,
      analyzed: 500,
      ignored: 0,
      languages: ["TypeScript"],
    },
    nodes,
    edges,
    issues: [],
    layout: { algorithm: "spherical-graph-v1", seed: 1, radius: 200 },
  };
};
