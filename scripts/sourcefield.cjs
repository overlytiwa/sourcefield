#!/usr/bin/env node
// Development/source launcher. Installed Windows builds ship a standalone .cmd.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const fail = (message) => {
  console.error("Sourcefield: " + message);
  process.exitCode = 1;
};
if (args[0] === "mcp") {
  const entry = path.resolve(__dirname, "../dist-electron/mcp.cjs");
  if (!fs.existsSync(entry)) {
    console.error("Build Sourcefield first with npm run build.");
    process.exit(1);
  }
  require(entry)
    .startMcpServer()
    .catch(() =>
      fail(
        "The MCP server couldn’t start. Check that Sourcefield is installed and try again.",
      ),
    );
} else {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Sourcefield\n\nUsage: sourcefield [directory | map.sourcefield]\n\n  sourcefield .      Open and visualize the current directory\n  sourcefield        Open the desktop app\n  sourcefield mcp    Start the local MCP stdio server\n",
    );
    process.exit(0);
  }
  if (args.includes("--version")) {
    console.log(require("../package.json").version);
    process.exit(0);
  }
  const appPath = path.resolve(__dirname, "..");
  if (args.length > 1 || args[0]?.startsWith("-")) {
    console.error(
      "Sourcefield: Choose one project folder or .sourcefield map. Use --help for examples.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(path.join(appPath, "dist-electron/main.cjs"))) {
    console.error(
      "Sourcefield is not built yet. Run npm run build in " + appPath,
    );
    process.exit(1);
  }
  let targetArgs = [];
  if (args[0]) {
    const target = path.resolve(process.cwd(), args[0]);
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) targetArgs = ["--project", target];
      else if (target.toLowerCase().endsWith(".sourcefield"))
        targetArgs = ["--map", target];
      else throw new Error("Choose a directory or a .sourcefield file.");
    } catch (error) {
      console.error(
        "Sourcefield: " +
          (["EACCES", "EPERM"].includes(error.code)
            ? "This folder or file can’t be accessed. Check its permissions and try again."
            : ["ENOENT", "ENOTDIR"].includes(error.code)
              ? "That folder or map could not be found. Check its path and try again."
              : "Choose a project folder or a .sourcefield map."),
      );
      process.exit(1);
    }
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let executable;
  try {
    executable = require("electron");
  } catch {
    console.error(
      "Sourcefield: The desktop runtime is missing. Run npm install in the Sourcefield source directory.",
    );
    process.exit(1);
  }
  const child = spawn(executable, [appPath, ...targetArgs], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env,
  });
  child.once("error", () =>
    fail(
      "The application couldn’t start. Check that Sourcefield is installed correctly and try again.",
    ),
  );
  child.once("spawn", () => child.unref());
}
