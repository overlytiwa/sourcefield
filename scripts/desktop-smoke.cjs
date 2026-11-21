// Native Electron lifecycle/IPC check in an isolated fixture. Linux needs Xvfb.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sf-desktop-"));
const project = path.join(temp, "project");
fs.cpSync(path.resolve("example"), project, { recursive: true });
fs.mkdirSync(path.join(temp, "settings"), { recursive: true });
app.setPath("userData", path.join(temp, "settings"));
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
process.argv.push("--project", project);
const timeout = setTimeout(() => {
  console.error("Desktop check timed out");
  app.exit(1);
}, 60000);
app.on("browser-window-created", (_event, win) => {
  win.webContents.once("did-finish-load", async () => {
    try {
      const first = await win.webContents.executeJavaScript(
        "window.sourcefield.ready()",
      );
      assert(
        first.ok && first.value.project.files > 0,
        "Startup scan must activate successfully",
      );
      const refreshed = await win.webContents.executeJavaScript(
        "window.sourcefield.refresh()",
      );
      assert(refreshed.ok, "Refresh must complete after the worker exits");
      const state = await win.webContents.executeJavaScript(
        "window.sourcefield.workbench('state',{})",
      );
      assert(state.watching, "Source watcher is active");
      const features = await win.webContents.executeJavaScript(
        "window.sourcefield.workbench('features',{})",
      );
      assert(Array.isArray(features.entries));
      const errorMessage = await win.webContents.executeJavaScript(
        "window.sourcefield.workbench('changes',{}).then(() => null, error => error.message)",
      );
      assert.match(errorMessage, /This folder isn’t a Git repository/);
      assert.doesNotMatch(
        errorMessage,
        /Error invoking|Command failed|fsmonitor|fatal:/,
      );
      const large = require("./detail-fixture.cjs")();
      const saved = path.join(temp, "large.sourcefield");
      fs.writeFileSync(
        saved,
        Buffer.concat([
          Buffer.from("SOURCEFIELD\x00\x01\n", "binary"),
          require("node:zlib").gzipSync(Buffer.from(JSON.stringify(large))),
        ]),
      );
      const opened = win.webContents.executeJavaScript(
        "new Promise(resolve => { const stop = window.sourcefield.onMap(map => { stop(); resolve(map.nodes.length); }); })",
      );
      app.emit("open-file", { preventDefault() {} }, saved);
      assert.equal(await opened, 50000);
      const drawn = await win.webContents
        .executeJavaScript(`new Promise((resolve, reject) => {
        let requested = false;
        const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Large map did not render')); }, 25000);
        const timer = setInterval(() => {
          const scope = document.querySelector('select[aria-label="Map scope"]');
          if (scope && !requested) { scope.value = 'all'; scope.dispatchEvent(new Event('change', {bubbles:true})); requested = true; return; }
          const match = document.querySelector('.graph-detail')?.textContent.match(/Showing ([\\d,]+) of 50,000 nodes and ([\\d,]+) of 193,000 connections/);
          if (match && Number(match[1].replaceAll(',', '')) > 0) {
            clearTimeout(timeout); clearInterval(timer);
            resolve({nodes:Number(match[1].replaceAll(',', '')), edges:Number(match[2].replaceAll(',', '')), error:document.querySelector('.render-error')?.textContent});
          }
        }, 150);
      })`);
      assert(!drawn.error, drawn.error);
      assert(
        drawn.nodes <= 6000 && drawn.edges <= 8000,
        "Native large-map rendering stays within its draw budget",
      );
      console.log(
        `Native Electron passed: lifecycle, refresh, friendly IPC errors and a 50,000-node / 193,000-connection map drawn as ${drawn.nodes} nodes / ${drawn.edges} connections.`,
      );
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});
app.on("quit", () => {
  try {
    fs.rmSync(temp, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {}
});
require("../dist-electron/main.cjs");
