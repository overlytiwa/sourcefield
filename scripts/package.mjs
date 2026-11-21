// Empty GitHub secrets must be absent, not interpreted as certificate paths.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const env = { ...process.env };
for (const key of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
])
  if (!env[key]) delete env[key];
const entry = require.resolve("electron-builder/cli.js");
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
