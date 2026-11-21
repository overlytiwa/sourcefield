import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { UserError, userMessage } from "../../shared/errors";
import type { ArchitectureRule } from "../../shared/workbench";
import type { CodeMap, ScanOptions } from "../../shared/types";
import { scanProject } from "../analyzer/scan";
import { architecture, compareMaps } from "./graph";
const exec = promisify(execFile);
export async function git(root: string, args: string[]) {
  try {
    const { stdout } = await exec(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.pager=cat", ...args],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, LC_ALL: "C" },
      },
    );
    return stdout;
  } catch (error) {
    const value = error as NodeJS.ErrnoException & {
      stderr?: string;
      killed?: boolean;
    };
    if (
      value.code === "ENOENT" ||
      value.code === "EACCES" ||
      value.code === "EPERM" ||
      value.killed ||
      /not a git repository|dubious ownership|permission denied/i.test(
        value.stderr ?? "",
      )
    )
      throw new UserError(
        userMessage(
          error,
          "Git couldn’t finish checking this project. Try again.",
        ),
        "GIT_UNAVAILABLE",
      );
    throw error;
  }
}
export async function revision(root: string, ref: string) {
  if (
    !ref ||
    ref.length > 200 ||
    ref.startsWith("-") ||
    /[\x00-\x20]/.test(ref)
  )
    throw new Error("Provide a Git revision such as HEAD or main.");
  if (!(await fs.stat(root)).isDirectory())
    throw new UserError(
      "Choose a project folder to review Git changes.",
      "GIT_REQUIRED",
    );
  if (
    (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true"
  )
    throw new UserError(
      "Open a project’s working folder to review Git changes.",
      "GIT_REQUIRED",
    );
  try {
    return (
      await git(root, ["rev-parse", "--verify", `${ref}^{commit}`])
    ).trim();
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (
      !/Needed a single revision|unknown revision|bad revision|expected commit type|not a valid object/i.test(
        String((error as { stderr?: string }).stderr),
      )
    )
      throw error;
    try {
      await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    } catch (headError) {
      if (headError instanceof UserError) throw headError;
      throw new UserError(
        "This Git project has no commits yet. Make your first commit to start reviewing changes.",
        "NO_COMMITS",
      );
    }
    throw new UserError(
      `The Git revision “${ref}” wasn’t found. Choose a branch or commit available in this project.`,
      "REVISION_NOT_FOUND",
    );
  }
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

/** Cheap polling detects commits, staging and repeated edits without rebuilding a baseline. */
export async function changeState(root: string, ref = "HEAD") {
  const { sha, files } = await changedFiles(root, ref);
  const head = ref === "HEAD" ? sha : await revision(root, "HEAD");
  const stamps = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(path.join(root, file.path));
      stamps.push([
        file.path,
        file.status,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
      ]);
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      stamps.push([file.path, file.status, "missing"]);
    }
  }
  return createHash("sha256")
    .update(JSON.stringify([sha, head, stamps]))
    .digest("hex");
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
