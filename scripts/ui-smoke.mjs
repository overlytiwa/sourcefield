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
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, waitFor, cleanup } =
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
  const map = await scanProject(root, () => {}),
    price = map.nodes.find((n) => n.name === "price" && n.kind === "function");
  service = await Workbench.open(
    map,
    root,
    path.join(temp, "settings"),
    () => {},
  );
  window.sourcefield = {
    workbench: (action, args) => service.execute(action, args),
  };
  let focused = [];
  render(
    React.createElement(WorkbenchUI, {
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
    }),
  );
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
  await click("Compare changes");
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
  console.log(
    "Workbench UI passed: create investigation, add a symbol, save view, create a tour, follow a feature, import stack frames and compare real Git changes. Native/WebGL UI not exercised.",
  );
} finally {
  cleanup();
  await service?.close();
  dom.window.close();
  await fs.rm(temp, { recursive: true, force: true });
  await fs.rm(apiFile, { force: true });
}
