import { build } from "esbuild";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
const apiFile = path.resolve("dist-electron/workbench-smoke-api.cjs");
await build({
  stdin: {
    contents:
      "export {collectScan} from './electron/scan-task';export {scanProject} from './electron/analyzer/scan';export {compareMaps,impact,architecture,mapObservations} from './electron/workbench/graph';export {changeReport,coChanges,changeState,revision} from './electron/workbench/git';export {Workbench} from './electron/workbench/service';export {encodeMap,decodeMap} from './electron/format';export {anchorFor,resolveAnchor} from './shared/workbench';export {userMessage} from './shared/errors';",
    resolveDir: process.cwd(),
  },
  outfile: apiFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["typescript", "web-tree-sitter"],
});
const api = createRequire(import.meta.url)(apiFile),
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "sf-workbench-"));
const put = async (p, text) => {
  const target = path.join(temp, p);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
};
const git = (...args) =>
  execFileSync("git", args, {
    cwd: temp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
let service;
try {
  const fake = new EventEmitter();
  fake.terminate = async () => 0;
  let activate;
  const activation = new Promise((resolve) => (activate = resolve));
  const pending = api.collectScan(
    fake,
    () => true,
    async () => activation,
    () => {},
  );
  fake.emit("message", { type: "complete", value: { format: "fixture" } });
  fake.emit("exit", 0);
  activate();
  assert.equal(
    (await pending).ok,
    true,
    "Worker exit cannot cancel asynchronous map activation",
  );
  const rawGitFailure = new Error(
    "Error invoking remote method 'sourcefield:workbench': Error: Command failed: git -c core.fsmonitor=false rev-parse --verify HEAD^{commit}\nfatal: not a git repository (or any of the parent directories): .git",
  );
  assert.equal(
    api.userMessage(rawGitFailure),
    "This folder isn’t a Git repository. Open a project with Git history to review changes.",
  );
  assert.match(
    api.userMessage(
      Object.assign(new Error("EACCES: open /private/project"), {
        code: "EACCES",
      }),
    ),
    /permission/,
  );
  assert.match(
    api.userMessage(
      Object.assign(new Error("ENOSPC: write"), { code: "ENOSPC" }),
    ),
    /disk space/,
  );
  assert.match(
    api.userMessage(new Error("Unrecognized Sourcefield map header.")),
    /exporting a new copy/,
  );
  assert.equal(
    api.userMessage(
      new Error("Command failed: something unexpected\ninternal details"),
    ),
    "Sourcefield couldn’t complete that action. Try again.",
  );
  await assert.rejects(
    api.changeState(temp),
    /This folder isn’t a Git repository/,
  );
  await assert.rejects(api.changeState(path.join(temp, "missing")), (error) =>
    /no longer available/.test(api.userMessage(error)),
  );
  await put(".gitignore", "ignored/*.js\n*.skip.js\n");
  await put("nested/.gitignore", "!keep.skip.js\n");
  await put("nested/keep.skip.js", "export const keep = 1;");
  await put(
    "packages/app/tsconfig.json",
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    }),
  );
  await put(
    "packages/app/src/price.ts",
    "export function price(value: number) { return value * 2; }\n",
  );
  await put(
    "packages/app/src/checkout.ts",
    "import {price} from '@/price';\nexport function checkout() { return price(20); }\n",
  );
  await put(
    "packages/app/src/price.test.ts",
    "import {price} from './price';\nexport function testPrice() { return price(4); }\n",
  );
  await put(
    "renderer.ts",
    "declare const ipcRenderer: any;\nexport function request() { return ipcRenderer.invoke('orders:export'); }\n",
  );
  await put(
    "native.ts",
    "declare const ipcMain: any;\nexport function writer() { return 1; }\nipcMain.handle('orders:export', () => writer());\n",
  );
  await put(
    "python/main.py",
    "def target():\n    return 1\ndef caller(value=target()):\n    return value\n",
  );
  const languages = {
    "Main.kt":
      "package demo\n\nfun target(value: String): String {\n    return value\n}\n\nfun caller(value: String): String {\n    return target(value)\n}\n",
    "main.scala":
      "object Demo {\n def target(value: String): String = value\n def caller(value: String): String = target(value)\n}\n",
    "main.sh": 'target() {\n echo "$1"\n}\ncaller() {\n target "$1"\n}\n',
    "main.dart":
      "String target(String value) { return value; }\nString caller(String value) { return target(value); }\n",
    "main.go":
      "package main\ntype Thing struct {}\nfunc (t Thing) Target() int { return 1 }\nfunc Caller(t Thing) int { return t.Target() }\n",
    "main.rs":
      "struct Thing {}\nimpl Thing { fn target(&self) -> i32 { 1 } }\nfn caller(t: Thing) -> i32 { t.target() }\n",
  };
  for (const [file, text] of Object.entries(languages))
    await put("languages/" + file, text);
  git("init", "-q");
  await assert.rejects(api.changeState(temp), /no commits yet/);
  git("config", "user.email", "fixture@example.test");
  git("config", "user.name", "Sourcefield fixture");
  git("add", ".");
  git("commit", "-qm", "initial");
  await assert.rejects(
    api.revision(temp, "not-a-real-branch"),
    /revision “not-a-real-branch” wasn’t found/,
  );
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = path.join(temp, "no-programs");
    await assert.rejects(api.changeState(temp), /Git isn’t available/);
  } finally {
    process.env.PATH = originalPath;
  }
  const before = await api.scanProject(temp, () => {});
  const byId = new Map(before.nodes.map((n) => [n.id, n]));
  assert(
    before.nodes.some((n) => n.path === "nested/keep.skip.js"),
    "Nested negation overrides parent glob",
  );
  const price = before.nodes.find(
    (n) => n.name === "price" && n.kind === "function",
  );
  assert(price);
  const edges = before.edges.filter(
    (e) => e.target === price.id && e.kind === "calls",
  );
  assert(
    edges.some((e) => byId.get(e.source).name === "checkout"),
    "Per-package aliases resolve",
  );
  assert(
    before.edges.some((e) => e.kind === "dispatches"),
    "Explicit Electron IPC channel joins request to handler",
  );
  assert(
    before.features.some((f) => f.kind === "IPC handler"),
    "Handler is a feature entry",
  );
  for (const [file] of Object.entries(languages)) {
    const nodes = before.nodes.filter((n) => n.path === "languages/" + file),
      ids = new Set(nodes.map((n) => n.id));
    assert(
      nodes.some(
        (n) =>
          ["target", "Target"].includes(n.name) &&
          ["function", "method"].includes(n.kind),
      ),
      file + " extracts declarations",
    );
    assert(
      before.edges.some(
        (e) => e.kind === "calls" && ids.has(e.source) && ids.has(e.target),
      ),
      file + " resolves local calls",
    );
    assert(
      !before.issues.some(
        (i) => i.path === "languages/" + file && i.kind === "skipped",
      ),
      file + " parser is available",
    );
  }
  assert(
    before.edges.some(
      (e) =>
        e.kind === "calls" && byId.get(e.target)?.path === "python/main.py",
    ),
    "Python default argument calls are traced",
  );
  const anchor = api.anchorFor(price);
  await put(
    "packages/app/src/price.ts",
    "// inserted before declaration\nexport function price(value: number) { return value * 3; }\n",
  );
  await put("new.ts", "export function added() {return 1;}\n");
  const after = await api.scanProject(
    temp,
    () => {},
    { includeDependencies: false },
    before,
  );
  const updated = after.nodes.find(
    (n) => n.name === "price" && n.kind === "function",
  );
  assert.equal(
    updated.id,
    price.id,
    "Semantic ID survives a preceding insertion",
  );
  assert.notEqual(
    updated.fingerprint,
    price.fingerprint,
    "Body edits change fingerprint",
  );
  assert.equal(api.resolveAnchor(after, anchor).status, "changed");
  const report = await api.changeReport(temp, after, "HEAD");
  assert(report.changed.includes(price.id));
  assert(
    report.impacted.some((i) => i.test),
    "Impact includes candidate tests",
  );
  assert(
    report.files.some((f) => f.path === "new.ts"),
    "Untracked source included",
  );
  const cached = await api.scanProject(
    temp,
    () => {},
    { includeDependencies: false },
    after,
  );
  assert.deepEqual(
    cached.nodes,
    after.nodes,
    "Unchanged analyzer cache preserves graph and positions",
  );
  const arch = api.architecture(after, [
    {
      id: "r",
      title: "No package cross-import",
      from: "packages/app/src/checkout",
      to: "packages/app/src/price",
      kind: "imports",
    },
  ]);
  assert(arch.violations.length);
  assert.equal(
    api.mapObservations(
      after,
      "Error\n at price (/project/packages/app/src/price.ts:2:1)",
      "stack",
    ).observations[0].node_id,
    price.id,
  );
  assert(
    api
      .mapObservations(
        after,
        "SF:packages/app/src/price.ts\nDA:2,3\nend_of_record",
        "coverage",
      )
      .observations.some((o) => o.hits === 3),
  );
  assert(
    api.mapObservations(
      after,
      JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: "price",
                    attributes: [
                      {
                        key: "code.file.path",
                        value: { stringValue: "packages/app/src/price.ts" },
                      },
                      { key: "code.line.number", value: { intValue: "2" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      "trace",
    ).observations.length,
  );
  service = await api.Workbench.open(
    after,
    temp,
    path.join(temp, "settings"),
    () => {},
  );
  await service.execute("save", {
    data: {
      investigations: [
        {
          id: "task",
          title: "Price update",
          nodes: [anchor],
          notes: "Review consumers",
          questions: "Refunds?",
        },
      ],
      tours: [
        {
          id: "tour",
          title: "Checkout",
          steps: [{ anchor, note: "Compute price" }],
        },
      ],
      rules: [],
    },
  });
  const context = await service.execute("context", { id: "task" });
  assert.equal(context.nodes[0].status, "changed");
  service.record("get_symbol", { node_id: price.id }, true);
  await service.execute("save", { data: service.data });
  const roundtrip = api.decodeMap(
    api.encodeMap({ ...after, workbench: service.data }),
  );
  assert.equal(roundtrip.workbench.tours[0].steps[0].note, "Compute price");
  await assert.rejects(
    service.execute("save", { data: { investigations: "invalid" } }),
  );
  await service.close();
  service = await api.Workbench.open(
    after,
    temp,
    path.join(temp, "settings"),
    () => {},
  );
  assert.equal(
    (await service.execute("state")).data.investigations[0].title,
    "Price update",
  );
  console.log(
    "Workbench checks passed: Kotlin/Dart/Scala/Bash/Go/Rust calls, monorepo aliases, ignore precedence, message flows, Git changes and impact, stable IDs, incremental reuse, rules, stack/LCOV/OTLP imports, saved investigations, tours, activity and portable maps.",
  );
} finally {
  await service?.close();
  await fs.rm(temp, { recursive: true, force: true });
  await fs.rm(apiFile, { force: true });
}
