#!/usr/bin/env node
// Native build + GitHub release upload. Run on each target OS with GH_TOKEN set.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: npm run release [-- --win|--mac|--linux]\nBuilds, tests, packages and publishes this platform to the GitHub release for package.json.version. Requires GH_TOKEN with contents:write. CI builds all platforms and publishes one complete release when a new version reaches main, on a v* tag, or by workflow dispatch.",
  );
  process.exit(0);
}
if (args.some((a) => !["--win", "--mac", "--linux"].includes(a)))
  throw new Error("Only --win, --mac and --linux are supported.");
if (!process.env.GH_TOKEN)
  throw new Error(
    "Set GH_TOKEN to a GitHub token with contents:write before publishing.",
  );
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw new Error("Release version must be a stable semantic version.");
const run = (cmd, cmdArgs) => {
  const r = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("npm", ["run", "build"]);
run("npm", ["run", "test:core"]);
run(process.execPath, ["scripts/package.mjs", ...args, "--publish", "always"]);
