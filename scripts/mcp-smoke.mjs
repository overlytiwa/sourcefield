// A short protocol integration check. No AI accounts, network, or GUI required.
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
  mkdtemp,
  cp,
  writeFile,
  readFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd(),
  apiFile = path.join(root, "dist-electron/mcp-smoke-api.cjs");
await build({
  stdin: {
    contents:
      "export {Workbench} from './electron/workbench/service'; export {scanProject} from './electron/analyzer/scan'; export {ProjectQuery} from './electron/mcp/query'; export {startLocalBridge,callLocalBridge} from './electron/mcp/bridge'; export {launchTarget} from './electron/launch-target'; export {writeMap,readMap} from './electron/format';",
    resolveDir: root,
  },
  outfile: apiFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["typescript", "web-tree-sitter"],
});
const api = createRequire(import.meta.url)(apiFile);
const temp = await mkdtemp(path.join(os.tmpdir(), "sf-mcp-"));
const clients = [];
let bridge, workbench;
try {
  const project = path.join(temp, "project with spaces");
  await cp(path.join(root, "example"), project, { recursive: true });
  await writeFile(
    path.join(project, "src/escape.js"),
    "export const safe = true;\n",
  );
  const map = await api.scanProject(project, () => {});
  workbench = await api.Workbench.open(
    map,
    project,
    path.join(temp, "settings"),
    () => {},
  );
  let current = new api.ProjectQuery(map, project, workbench),
    lastViewAction;
  const view = {
    position: [0, 0, 300],
    target: [0, 0, 0],
    selected: null,
    visibleEdges: ["calls", "contains"],
    labels: true,
  };
  const descriptor = path.join(temp, "bridge", "mcp-bridge.json");
  bridge = await api.startLocalBridge(
    (name, args) =>
      current.execute(name, args, async (command) => {
        lastViewAction = command;
        if (command.action === "focus") view.selected = command.node_id;
        return { view, highlighted_node_ids: command.node_ids ?? [] };
      }),
    descriptor,
  );
  const standalone = path.join(temp, "standalone-mcp.cjs");
  await cp(path.join(root, "dist-electron/mcp.cjs"), standalone);
  async function connect(name, args) {
    const client = new Client({ name, version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args,
        env: { ...process.env, SOURCEFIELD_MCP_BRIDGE: descriptor },
        stderr: "pipe",
      }),
    );
    return client;
  }
  const first = await connect("sourcefield-smoke-client-one", [
    path.join(root, "scripts/sourcefield.cjs"),
    "mcp",
  ]);
  const second = await connect("sourcefield-smoke-client-two", [standalone]);
  const tools = await first.listTools();
  assert.equal(tools.tools.length, 18);
  async function call(client, name, args = {}) {
    const reply = await client.callTool({
      name: "sourcefield_" + name,
      arguments: args,
    });
    assert(!reply.isError, JSON.stringify(reply.content));
    return reply.structuredContent;
  }
  const overview = await call(first, "project_overview");
  assert.equal(
    (await call(second, "project_overview")).project_id,
    overview.project_id,
  );
  const search = await call(first, "search_symbols", {
    query: "matchesQuery",
    kinds: ["function"],
  });
  assert(search.results.length);
  const symbol = search.results[0];
  assert.equal(symbol.path, "src/search.js");
  assert(symbol.preview.includes("matchesQuery"));
  const detail = await call(first, "get_symbol", { node_id: symbol.node_id });
  assert(detail.saved_source_preview);
  const connections = await call(first, "get_connections", {
    node_id: symbol.node_id,
    kinds: ["calls"],
    direction: "incoming",
  });
  assert(connections.results.some((e) => e.other.path === "src/notebook.js"));
  assert(Array.isArray((await call(first, "get_features")).entries));
  assert(Array.isArray((await call(first, "get_activity")).investigations));
  assert(
    Array.isArray(
      (await call(first, "get_impact", { node_id: symbol.node_id })).items,
    ),
  );
  assert(Array.isArray((await call(first, "get_architecture")).cycles));
  await workbench.execute("save", {
    data: {
      investigations: [
        {
          id: "task",
          title: "Query task",
          nodes: [],
          notes: "Context",
          questions: "",
        },
      ],
      tours: [{ id: "tour", title: "Query tour", steps: [] }],
      rules: [],
    },
  });
  assert.equal(
    (await call(first, "get_investigation", { id: "task" })).title,
    "Query task",
  );
  assert.equal(
    (await call(first, "get_tour", { id: "tour" })).title,
    "Query tour",
  );
  const job = await call(first, "compare_changes");
  assert(job.job_id);
  assert(
    ["running", "failed", "complete"].includes(
      (await call(first, "get_comparison", { job_id: job.job_id })).status,
    ),
  );
  const trace = await call(first, "trace_dependencies", {
    node_id: symbol.node_id,
  });
  assert(trace.edges.length);
  const source = await call(first, "read_source", { node_id: symbol.node_id });
  assert.equal(source.source, "current_local_file");
  assert(source.lines.some((l) => l.text.includes("normalize")));
  assert(
    (await call(first, "search_source", { query: "matchesQuery" })).results
      .length,
  );
  assert((await call(first, "get_diagnostics")).results.length);
  await call(first, "get_view");
  const focused = await call(first, "control_view", {
    action: "focus",
    node_id: symbol.node_id,
    project_id: overview.project_id,
  });
  assert.equal(lastViewAction.action, "focus");
  assert.equal(focused.view.selected, symbol.node_id);
  const page = await call(first, "search_symbols", { query: "note", limit: 1 });
  assert.equal(page.results.length, 1);
  assert.equal(page.next_offset, 1);
  const escaped = await first.callTool({
    name: "sourcefield_read_source",
    arguments: { path: "../private.txt" },
  });
  assert(escaped.isError);
  if (process.platform !== "win32") {
    await writeFile(path.join(temp, "private.txt"), "PRIVATE TEST DATA");
    await rm(path.join(project, "src/escape.js"));
    await symlink(
      path.join(temp, "private.txt"),
      path.join(project, "src/escape.js"),
    );
    const outside = await first.callTool({
      name: "sourcefield_read_source",
      arguments: { path: "src/escape.js" },
    });
    assert(outside.isError);
  }
  const config = JSON.parse(await readFile(descriptor, "utf8"));
  const badDescriptor = path.join(temp, "invalid-auth.json");
  await writeFile(
    badDescriptor,
    JSON.stringify({ ...config, token: "0".repeat(64) }),
  );
  await assert.rejects(
    api.callLocalBridge("project_overview", {}, badDescriptor),
    /Unauthorized/,
  );
  const exported = path.join(temp, "map with spaces.SOURCEFIELD");
  await api.writeMap(exported, map);
  await workbench.close();
  await rename(project, path.join(temp, "moved"));
  current = new api.ProjectQuery(await api.readMap(exported), null);
  const offline = await call(second, "read_source", {
    node_id: symbol.node_id,
  });
  assert.equal(offline.source, "saved_symbol_preview");
  const stale = await first.callTool({
    name: "sourcefield_get_symbol",
    arguments: { node_id: symbol.node_id, project_id: overview.project_id },
  });
  assert(stale.isError);
  assert.equal(
    api.launchTarget(["Sourcefield.exe", exported], temp, true).file,
    exported,
  );
  assert.equal(
    api.launchTarget(["Sourcefield.exe", "--map", exported], temp, true).file,
    exported,
  );
  assert.equal(
    api.launchTarget(["electron", root, exported], temp, false).file,
    exported,
  );
  console.log(
    "MCP smoke passed: two stdio clients, all 18 tools, cross-file calls, paging, view command acknowledgement, scoped reads, authentication, offline maps, project IDs, and Explorer arguments.",
  );
} finally {
  for (const client of clients) await client.close();
  await bridge?.close();
  await workbench?.close();
  await rm(temp, { recursive: true, force: true });
  await rm(apiFile, { force: true });
}
