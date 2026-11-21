import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ArchitectureRule } from "../../shared/workbench";
import type { CodeMap, ScanOptions } from "../../shared/types";
import { scanProject } from "../analyzer/scan";
import { architecture, compareMaps } from "./graph";
const exec = promisify(execFile);
export async function git(root: string, args: string[]) {
  const { stdout } = await exec(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "core.pager=cat", ...args],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60000,
      windowsHide: true,
    },
  );
  return stdout;
}
export async function revision(root: string, ref: string) {
  if (
    !ref ||
    ref.length > 200 ||
    ref.startsWith("-") ||
    /[\x00-\x20]/.test(ref)
  )
    throw new Error("Provide a Git revision such as HEAD or main.");
  return (await git(root, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
}
export async function changedFiles(root: string, ref = "HEAD") {
  const sha = await revision(root, ref);
  const tracked = (
    await git(root, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "--relative",
      "-z",
      "--no-renames",
      sha,
      "--",
    ])
  ).split("\0");
  const files: { path: string; status: string }[] = [];
  for (let i = 0; i < tracked.length - 1; i += 2)
    files.push({ status: tracked[i], path: tracked[i + 1] });
  for (const p of (
    await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  )
    .split("\0")
    .filter(Boolean))
    files.push({ path: p, status: "?" });
  return { sha, files };
}
export async function baselineMap(
  root: string,
  ref: string,
  options: ScanOptions,
) {
  const sha = await revision(root, ref),
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "sourcefield-base-"));
  try {
    const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
    const tree = prefix ? sha + ":" + prefix.replace(/\/$/, "") : sha;
    const entries = (await git(root, ["ls-tree", "-rz", tree, "--"]))
      .split("\0")
      .filter(Boolean);
    let total = 0,
      count = 0;
    for (const entry of entries) {
      const m = entry.match(/^(100644|100755) blob ([0-9a-f]+)\t(.+)$/s);
      if (!m) continue;
      const relative = m[3];
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
        continue;
      if (++count > 12000)
        throw new Error(
          "Base revision exceeds 12,000 files. Open a smaller repository.",
        );
      const size = Number((await git(root, ["cat-file", "-s", m[2]])).trim());
      if (size > 2 * 1024 * 1024) continue;
      const { stdout: bytes } = await exec("git", ["cat-file", "blob", m[2]], {
        cwd: root,
        encoding: "buffer",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 60000,
        windowsHide: true,
      });
      total += Buffer.byteLength(bytes);
      if (total > 128 * 1024 * 1024)
        throw new Error("Base revision exceeds the 128 MiB comparison budget.");
      if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) continue;
      const target = path.join(temp, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    return await scanProject(temp, () => {}, options);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
export async function changeReport(
  root: string,
  map: CodeMap,
  ref = "HEAD",
  rules: ArchitectureRule[] = [],
) {
  const changes = await changedFiles(root, ref);
  const before = await baselineMap(
    root,
    changes.sha,
    map.scan ?? { includeDependencies: false },
  );
  const report = compareMaps(before, map, changes.files, ref);
  const old = architecture(before, rules),
    current = architecture(map, rules);
  const oldCycles = new Set(old.cycles.map((c) => [...c].sort().join("|"))),
    oldViolations = new Set(
      old.violations.map((v) => v.edge_id + ":" + v.rule),
    );
  report.architecture = {
    new_cycles: current.cycles.filter(
      (c) => !oldCycles.has([...c].sort().join("|")),
    ),
    introduced_violations: current.violations.filter(
      (v) => !oldViolations.has(v.edge_id + ":" + v.rule),
    ),
  };
  return report;
}
export async function coChanges(root: string, paths: string[]) {
  const raw = await git(root, [
    "log",
    "-n",
    "200",
    "--format=%x00%H",
    "--name-only",
    "--relative",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--",
  ]);
  const selected = new Set(paths),
    pairs = new Map<
      string,
      { path: string; count: number; commits: string[] }
    >();
  let samples = 0;
  for (const block of raw.split("\0")) {
    const [sha, ...lines] = block.trim().split("\n");
    if (!/^[a-f0-9]{40,64}$/.test(sha ?? "")) continue;
    const files = [...new Set(lines.filter(Boolean))];
    if (files.length > 50 || !files.some((p) => selected.has(p))) continue;
    samples++;
    for (const p of files)
      if (!selected.has(p)) {
        const value = pairs.get(p) ?? { path: p, count: 0, commits: [] };
        value.count++;
        if (value.commits.length < 10) value.commits.push(sha);
        pairs.set(p, value);
      }
  }
  return {
    sample_commits: samples,
    results: [...pairs.values()]
      .filter((p) => p.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    note: "Co-change suggests a review candidate, not a required edit. Last 200 commits; bulk changes over 50 files excluded.",
  };
}
