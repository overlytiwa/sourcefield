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
      console.log(
        "Native Electron passed: preload bridge, startup scan, asynchronous activation, refresh, watcher and workbench IPC.",
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
