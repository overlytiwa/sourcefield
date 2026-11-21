import { promises as fs } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const root = process.cwd(),
  launcher = path.join(root, "scripts/sourcefield.cjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sf-cli-"));
try {
  const cwd = path.join(temp, "project with spaces");
  await fs.mkdir(cwd);
  const record = path.join(temp, "launch.json");
  const mock = path.join(temp, "record-launch.cjs");
  await fs.writeFile(
    mock,
    `const fs = require('node:fs'); const {EventEmitter} = require('node:events'); require('node:child_process').spawn = (exe, args, options) => {fs.writeFileSync(process.env.SOURCEFIELD_LAUNCH_RECORD, JSON.stringify({exe,args,cwd:options.cwd,runAsNode:options.env.ELECTRON_RUN_AS_NODE})); const child = new EventEmitter(); child.unref=()=>{}; process.nextTick(()=>child.emit('spawn')); return child;};`,
  );
  const env = {
    ...process.env,
    SOURCEFIELD_LAUNCH_RECORD: record,
    ELECTRON_RUN_AS_NODE: "1",
  };
  execFileSync(process.execPath, ["--require", mock, launcher, "."], {
    cwd,
    env,
  });
  let launch = JSON.parse(await fs.readFile(record, "utf8"));
  assert.deepEqual(launch.args, [root, "--project", cwd]);
  assert.equal(launch.cwd, cwd);
  assert.equal(launch.runAsNode, undefined);
  const map = path.join(cwd, "my map.SOURCEFIELD");
  await fs.writeFile(map, "fixture");
  execFileSync(process.execPath, ["--require", mock, launcher, map], {
    cwd,
    env,
  });
  launch = JSON.parse(await fs.readFile(record, "utf8"));
  assert.deepEqual(launch.args, [root, "--map", map]);
  const missing = spawnSync(process.execPath, [launcher, "missing"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /could not be found/);
  assert.doesNotMatch(missing.stderr, /ENOENT|at Object|node:fs/);
  assert.match(
    execFileSync(process.execPath, [launcher, "--help"], { encoding: "utf8" }),
    /sourcefield \./,
  );

  if (process.platform === "win32") {
    const powershell = path.join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    execFileSync(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(root, "scripts/windows-cli-smoke.ps1"),
        "-Root",
        root,
        "-Temp",
        temp,
      ],
      { stdio: "inherit" },
    );
  }
  console.log(
    "CLI checks passed: current directory, spaces, maps, startup environment and helpful errors" +
      (process.platform === "win32"
        ? "; installed Windows launcher, MCP and safe PATH add/remove."
        : ". Windows installer integration is checked on Windows builds."),
  );
} finally {
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
