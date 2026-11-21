import { build } from "esbuild";
import { mkdir, copyFile, rm, readFile, writeFile } from "node:fs/promises";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
await rm("dist-electron", { recursive: true, force: true });
await mkdir("dist-electron", { recursive: true });
await writeFile("dist-electron/version.txt", version + "\n");
await build({
  entryPoints: {
    main: "electron/main.ts",
    preload: "electron/preload.ts",
    worker: "electron/worker.ts",
    mcp: "electron/mcp/server.ts",
    "task-worker": "electron/task-worker.ts",
  },
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "typescript", "web-tree-sitter"],
  sourcemap: true,
  loader: { ".md": "text" },
});
await copyFile(
  "electron/analyzer/python_analyzer.py",
  "dist-electron/python_analyzer.py",
);
