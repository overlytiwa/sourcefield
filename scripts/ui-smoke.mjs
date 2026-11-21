// DOM interaction regression for the workbench, backed by the real local service.
// Does not create a WebGL context or exercise native installer/update behaviour.
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, waitFor, cleanup, act } =
  await import("@testing-library/react");
const React = await import("react");
const apiFile = path.resolve("dist-electron/ui-smoke-api.cjs");
await build({
  stdin: {
    contents:
      "export {Workbench as WorkbenchUI} from './src/components/Workbench';export {Workbench} from './electron/workbench/service';export {scanProject} from './electron/analyzer/scan';",
    resolveDir: process.cwd(),
  },
  outfile: apiFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "typescript",
    "web-tree-sitter",
  ],
});
const { Workbench, WorkbenchUI, scanProject } = createRequire(import.meta.url)(
  apiFile,
);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sf-ui-")),
  root = path.join(temp, "project");
await fs.mkdir(root);
let service;
try {
  await fs.writeFile(
    path.join(root, "price.ts"),
    "export function price(value:number) {return value*2;}\n",
  );
  await fs.writeFile(
    path.join(root, "checkout.ts"),
    "import {price} from './price'; export function checkout(){return price(2);}\n",
  );
  await fs.writeFile(
    path.join(root, "server.ts"),
    "declare const app:any; app.get('/checkout', () => 1);\n",
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "fixture@example.test");
  git("config", "user.name", "Fixture");
  git("add", ".");
  git("commit", "-qm", "base");
  await fs.writeFile(
    path.join(root, "price.ts"),
    "export function price(value:number) {return value*3;}\n",
  );
  let map = await scanProject(root, () => {});
  const price = map.nodes.find(
    (n) => n.name === "price" && n.kind === "function",
  );
  const listeners = new Set();
  let comparisons = 0,
    statusChecks = 0,
    refreshes = 0;
  let delayNext = false,
    releaseComparison,
    comparisonWaiting;
  service = await Workbench.open(
    map,
    root,
    path.join(temp, "settings"),
    (value) => {
      for (const listener of listeners) listener(value);
    },
  );
  await new Promise((resolve) => service.watcher.once("ready", resolve));
  window.sourcefield = {
    workbench: async (action, args) => {
      const result = await service.execute(action, args);
      if (action === "changes-status") statusChecks++;
      if (action === "changes") {
        comparisons++;
        if (delayNext) {
          delayNext = false;
          comparisonWaiting = true;
          await new Promise((resolve) => {
            releaseComparison = resolve;
          });
        }
      }
      return result;
    },
    onDirty: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let focused = [];
  const props = {
    map,
    selected: price.id,
    onSelect: () => {},
    onFocus: (ids) => (focused = ids),
    onClose: () => {},
    capture: () => ({
      position: [0, 0, 300],
      target: [0, 0, 0],
      selected: price.id,
      visibleEdges: ["calls"],
      labels: true,
    }),
    onRestore: () => {},
    notify: () => {},
    onRefresh: async () => {
      const version = service.editVersion;
      map = await scanProject(root, () => {}, map.scan, map);
      service.replace(map, version);
      view.rerender(React.createElement(WorkbenchUI, { ...props, map }));
      refreshes++;
      return true;
    },
  };
  const view = render(React.createElement(WorkbenchUI, props));
  await waitFor(() => assert(screen.getByText(/1 changed files ·/)), {
    timeout: 60000,
  });
  assert.equal(comparisons, 1, "Opening Changes compares automatically");
  const click = async (name) => {
    await waitFor(() =>
      assert(
        !screen.getByRole("button", { name, exact: true }).matches(":disabled"),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name, exact: true }));
    await waitFor(
      () =>
        assert.equal(
          document.querySelector(".workbench-body").getAttribute("aria-busy"),
          "false",
        ),
      { timeout: 60000 },
    );
  };
  await click("Investigations");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Investigation title" }),
    { target: { value: "Price review" } },
  );
  await click("Create investigation");
  await waitFor(() =>
    assert(screen.getByRole("heading", { name: "Price review" })),
  );
  fireEvent.click(screen.getByRole("button", { name: /Add selected node/ }));
  await waitFor(() =>
    assert.equal(service.data.investigations[0].nodes.length, 1),
  );
  await click("Save current view");
  await waitFor(() => assert(service.data.investigations[0].view));
  await click("Tours");
  fireEvent.change(screen.getByRole("textbox", { name: "Tour title" }), {
    target: { value: "Checkout tour" },
  });
  await click("Create tour");
  await screen.findByRole("textbox", { name: "Step explanation" });
  fireEvent.change(screen.getByRole("textbox", { name: "Step explanation" }), {
    target: { value: "Compute the total" },
  });
  await click("Add selected node as a step");
  await waitFor(() => assert.equal(service.data.tours[0].steps.length, 1));
  await click("Features");
  assert(screen.getByText("GET /checkout"));
  await click("Explore connected code");
  assert(focused.length);
  await click("Debug");
  fireEvent.change(screen.getByRole("textbox", { name: "Observation text" }), {
    target: { value: "Error\n at price (/project/price.ts:1:1)" },
  });
  await click("Locate on map");
  await waitFor(() =>
    assert(screen.getByText("1 mapped observations · 0 unmatched examples")),
  );
  await click("Changes");
  await waitFor(() => assert(screen.getByText(/changed files ·/)), {
    timeout: 60000,
  });
  await waitFor(() =>
    assert.equal(
      document.querySelector(".workbench-body").getAttribute("aria-busy"),
      "false",
    ),
  );
  assert.equal(screen.queryAllByRole("alert").length, 0);

  // Saving an already-modified file must produce a new scan/report without a click.
  const previousComparisons = comparisons;
  await fs.writeFile(
    path.join(root, "price.ts"),
    "export function price(value:number) {return value*4;}\n",
  );
  await waitFor(
    () => assert(refreshes > 0 && comparisons > previousComparisons),
    { timeout: 60000 },
  );
  assert.match(
    service.map.nodes.find((n) => n.id === price.id).excerpt,
    /value\*4/,
  );

  // Git metadata is excluded from the source watcher. Polling still notices a commit.
  git("add", ".");
  git("commit", "-qm", "updated price");
  await waitFor(() => assert(screen.getByText(/0 changed files ·/)), {
    timeout: 60000,
  });

  fireEvent.change(screen.getByRole("textbox", { name: "Base revision" }), {
    target: { value: "missing-branch" },
  });
  await waitFor(
    () =>
      assert.match(
        screen.getByRole("alert").textContent,
        /revision “missing-branch” wasn’t found/,
      ),
    { timeout: 10000 },
  );
  assert.doesNotMatch(
    screen.getByRole("alert").textContent,
    /Command failed|Error invoking|fsmonitor|fatal:/,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Base revision" }), {
    target: { value: "HEAD" },
  });
  await waitFor(
    () => {
      assert(screen.getByText(/0 changed files ·/));
      assert.equal(screen.queryAllByRole("alert").length, 0);
    },
    { timeout: 60000 },
  );

  const unchangedComparisons = comparisons,
    unchangedRefreshes = refreshes,
    checksBefore = statusChecks;
  await waitFor(() => assert(statusChecks > checksBefore), { timeout: 10000 });
  assert.equal(
    comparisons,
    unchangedComparisons,
    "Idle polling does not rebuild comparison reports",
  );
  assert.equal(
    refreshes,
    unchangedRefreshes,
    "Idle polling does not rescan the project",
  );

  // A late result for an old revision must never replace the current comparison.
  delayNext = true;
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await waitFor(() => assert(comparisonWaiting), { timeout: 60000 });
  fireEvent.change(screen.getByRole("textbox", { name: "Base revision" }), {
    target: { value: "HEAD~1" },
  });
  await waitFor(() => assert(screen.getByText(/1 changed files ·/)), {
    timeout: 60000,
  });
  await act(async () => releaseComparison());
  assert(screen.getByText(/1 changed files ·/));

  // Hidden views defer file-triggered checks and resume automatically when visible.
  const beforeHidden = comparisons,
    editVersion = service.editVersion;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  await fs.writeFile(
    path.join(root, "price.ts"),
    "export function price(value:number) {return value*5;}\n",
  );
  await waitFor(() => assert(service.editVersion > editVersion), {
    timeout: 10000,
  });
  assert.equal(comparisons, beforeHidden);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  fireEvent(document, new dom.window.Event("visibilitychange"));
  await waitFor(() => assert(comparisons > beforeHidden), { timeout: 60000 });
  assert.match(
    service.map.nodes.find((n) => n.id === price.id).excerpt,
    /value\*5/,
  );

  cleanup();
  assert.equal(
    listeners.size,
    0,
    "Unmounting stops automatic change subscriptions",
  );
  console.log(
    "Workbench UI passed: saved investigations and tours, features, stack frames, automatic Git comparisons, watched edits, commit polling, revision errors and recovery. Native/WebGL UI not exercised.",
  );
} finally {
  cleanup();
  await service?.close();
  dom.window.close();
  await fs.rm(temp, { recursive: true, force: true });
  await fs.rm(apiFile, { force: true });
}
