import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { GraphBuilder, stableId } from "./graph";
import { analyzeTypeScript } from "./typescript";
import { analyzePython } from "./python";
import { layoutGraph } from "./layout";
import { languageFor } from "./languages";
import { enrichFeatures } from "./features";
import { stabilizeGraph } from "./identity";
import { analyzePolyglot } from "./polyglot";
import type { CodeMap, ScanOptions, ScanProgress } from "../../shared/types";
import { dependencyReason, generatedFolder } from "./folder-policy";

const supported = /\.(?:[cm]?[jt]sx?|py|pyi)$/i;
const javascript = /\.[cm]?[jt]sx?$/i;
const maxFiles = 12000,
  maxBytes = 2 * 1024 * 1024;
export async function scanProject(
  root: string,
  emit: (p: ScanProgress) => void,
  options: ScanOptions = { includeDependencies: false },
  previous?: CodeMap,
) {
  let lastPercent = 0;
  const progress = (p: ScanProgress) => {
    lastPercent = Math.max(lastPercent, p.percent);
    emit({ ...p, percent: lastPercent });
  };
  const absolute = path.resolve(root);
  if (!(await fs.stat(absolute)).isDirectory())
    throw new Error("Choose a project folder.");
  const graph = new GraphBuilder(path.basename(absolute));
  const scope = (graph.map.scan = {
    includeDependencies: options.includeDependencies,
    excludedDependencyCount: 0,
    excludedDependencies: [] as { path: string; reason: string }[],
  });
  const rootId = `d:${stableId(".")}`;
  graph.node(rootId, path.basename(absolute), "folder", ".");
  const files: {
    absolute: string;
    relative: string;
    id: string;
    size: number;
  }[] = [];
  const dependencies: { full: string; id: string }[] = [];
  let limitReached = false;
  async function walk(
    dir: string,
    parent: string,
    inherited: { base: string; matcher: Ignore }[],
  ) {
    if (limitReached) return;
    const rules = [...inherited];
    try {
      rules.push({
        base: dir,
        matcher: ignore().add(
          await fs.readFile(path.join(dir, ".gitignore"), "utf8"),
        ),
      });
    } catch {
      /* optional */
    }
    let entries;
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch {
      graph.issue({
        kind: "skipped",
        path: path.relative(absolute, dir),
        name: "Unreadable folder",
        reason: "The folder could not be read.",
      });
      return;
    }
    const siblings = new Set(entries.map((entry) => entry.name));
    for (const entry of entries) {
      if (limitReached) break;
      const full = path.join(dir, entry.name),
        relative = path.relative(absolute, full).split(path.sep).join("/");
      const secret =
        /^\.env(?:\.|$)/i.test(entry.name) ||
        /\.(?:pem|key|p12|pfx)$/i.test(entry.name);
      if (
        secret ||
        entry.isSymbolicLink() ||
        (entry.isDirectory() && generatedFolder(entry.name, siblings))
      ) {
        graph.map.project.ignored++;
        continue;
      }
      const dependency = entry.isDirectory()
        ? await dependencyReason(full, siblings)
        : undefined;
      if (dependency && !options.includeDependencies) {
        scope.excludedDependencyCount++;
        if (scope.excludedDependencies.length < 1000)
          scope.excludedDependencies.push({
            path: relative,
            reason: dependency,
          });
        graph.map.project.ignored++;
        continue; // Prune before enumerating or reading the installed package tree.
      }
      const includeDependency = !!dependency && options.includeDependencies;
      let ignored = false;
      for (const rule of rules) {
        const test = rule.matcher.test(
          path.relative(rule.base, full).split(path.sep).join("/") +
            (entry.isDirectory() ? "/" : ""),
        );
        if (test.ignored) ignored = true;
        if (test.unignored) ignored = false;
      }
      if (!includeDependency && ignored) {
        graph.map.project.ignored++;
        continue;
      }
      if (entry.isDirectory()) {
        const id = `d:${stableId(relative)}`;
        graph.node(id, entry.name, "folder", relative, { parent });
        // Explicit opt-in overrides the parent's ignore rule for this dependency root.
        // Its own ignore rules, generated outputs, secrets and symlinks still apply.
        if (includeDependency) dependencies.push({ full, id });
        else await walk(full, id, rules);
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          graph.issue({
            kind: "limit",
            path: relative,
            name: "File limit reached",
            reason: `Scanning stopped at ${maxFiles.toLocaleString()} files. Choose a smaller folder to include more.`,
          });
          limitReached = true;
          break;
        }
        const id = `f:${stableId(relative)}`;
        let size = 0;
        try {
          size = (await fs.stat(full)).size;
        } catch {
          continue;
        }
        const extraLanguage = languageFor(entry.name);
        const status =
          size > maxBytes
            ? "skipped"
            : supported.test(entry.name) || extraLanguage
              ? "analyzed"
              : "unsupported";
        const language = /\.pyi?$/i.test(entry.name)
          ? "Python"
          : /\.[cm]?tsx?$/i.test(entry.name)
            ? "TypeScript"
            : javascript.test(entry.name)
              ? "JavaScript"
              : extraLanguage?.name;
        const fingerprint =
          status === "analyzed"
            ? await fs
                .readFile(full)
                .then((bytes) =>
                  createHash("sha256").update(bytes).digest("hex"),
                )
                .catch(() => undefined)
            : undefined;
        graph.node(id, entry.name, "file", relative, {
          parent,
          status,
          language,
          fingerprint,
        });
        files.push({ absolute: full, relative, id, size });
        if (status !== "analyzed")
          graph.issue({
            kind: status === "skipped" ? "skipped" : "unsupported",
            path: relative,
            name: entry.name,
            reason:
              status === "skipped"
                ? "File exceeds the 2 MiB analysis limit."
                : "This file is shown in the hierarchy; its language is not analyzed.",
          });
        if (files.length % 40 === 0)
          progress({
            phase: "Reading project",
            detail: relative,
            percent: 5,
            files: files.length,
          });
      }
    }
  }
  progress({
    phase: "Reading project",
    detail: path.basename(absolute),
    percent: 2,
  });
  await walk(absolute, rootId, []);
  // Spend the bounded file budget on project code before installed libraries.
  // Nested dependency roots discovered during this pass are appended to the queue.
  for (let i = 0; i < dependencies.length && !limitReached; i++)
    await walk(dependencies[i].full, dependencies[i].id, []);
  graph.map.project.files = files.length;
  const js = files.filter(
    (f) => javascript.test(f.relative) && f.size <= maxBytes,
  );
  const py = files.filter(
    (f) => /\.pyi?$/i.test(f.relative) && f.size <= maxBytes,
  );
  const other = files.filter(
    (f) => languageFor(f.relative) && f.size <= maxBytes,
  );
  async function analyzeGroup(
    group: typeof files,
    languages: string[],
    analyze: () => Promise<void>,
  ) {
    if (!group.length) return;
    const oldFiles =
      previous?.nodes.filter(
        (n) =>
          n.kind === "file" &&
          languages.includes(n.language ?? "") &&
          (n.status === "analyzed" || n.status === "partial"),
      ) ?? [];
    const unchanged =
      previous &&
      previous.scan?.includeDependencies === options.includeDependencies &&
      group.length === oldFiles.length &&
      group.every((f) => {
        const old = oldFiles.find((n) => n.path === f.relative);
        return (
          old?.fingerprint &&
          old.fingerprint === graph.byId.get(f.id)?.fingerprint
        );
      });
    if (!unchanged) {
      await analyze();
      return;
    }
    const paths = new Set(group.map((f) => f.relative));
    const fileIds = new Map(group.map((f) => [f.relative, f.id]));
    const translate = new Map(
      previous.nodes
        .filter((n) => n.kind === "file" && paths.has(n.path))
        .map((n) => [n.id, fileIds.get(n.path)!]),
    );
    const symbols = previous.nodes.filter(
      (n) => n.kind !== "file" && n.kind !== "folder" && paths.has(n.path),
    );
    for (const n of symbols) translate.set(n.id, n.id);
    for (const n of symbols)
      graph.node(n.id, n.name, n.kind, n.path, {
        ...n,
        parent: n.parent ? translate.get(n.parent) : undefined,
      });
    for (const e of previous.edges)
      if (
        e.kind !== "contains" &&
        e.kind !== "dispatches" &&
        translate.has(e.source) &&
        translate.has(e.target)
      ) {
        const source = translate.get(e.source)!,
          target = translate.get(e.target)!;
        graph.edge(source, target, e.kind);
        const copied = graph.map.edges.at(-1);
        if (copied && copied.source === source && copied.target === target)
          Object.assign(copied, { ...e, source, target });
      }
    for (const issue of previous.issues)
      if (
        paths.has(issue.path) &&
        issue.kind !== "unsupported" &&
        issue.kind !== "limit"
      )
        graph.issue({
          ...issue,
          source: issue.source ? translate.get(issue.source) : undefined,
        });
    for (const f of group)
      graph.byId.get(f.id)!.status = oldFiles.find(
        (n) => n.path === f.relative,
      )!.status;
    progress({
      phase: "Reusing unchanged analysis",
      detail: languages.join(" · "),
      percent: 10,
    });
  }
  await analyzeGroup(js, ["JavaScript", "TypeScript"], () =>
    analyzeTypeScript(absolute, js, graph, progress),
  );
  await analyzeGroup(
    other,
    [...new Set(other.map((f) => languageFor(f.relative)!.name))],
    () => analyzePolyglot(absolute, other, graph, progress),
  );
  await analyzeGroup(py, ["Python"], () =>
    analyzePython(absolute, py, graph, progress),
  );
  graph.map.project.analyzed = graph.map.nodes.filter(
    (n) =>
      n.kind === "file" && (n.status === "analyzed" || n.status === "partial"),
  ).length;
  graph.map.project.languages = [
    ...new Set(
      graph.map.nodes
        .filter(
          (n) =>
            n.kind === "file" &&
            n.status !== "unsupported" &&
            n.status !== "skipped",
        )
        .map((n) => n.language)
        .filter((s): s is string => !!s),
    ),
  ];
  await enrichFeatures(graph.map, files);
  graph.finalize();
  stabilizeGraph(graph.map);
  progress({
    phase: "Arranging the map",
    detail: `${graph.map.nodes.length.toLocaleString()} nodes`,
    percent: 85,
    symbols: graph.map.nodes.length,
  });
  layoutGraph(graph.map);
  if (previous) {
    const positions = new Map(previous.nodes.map((n) => [n.id, n.position]));
    for (const n of graph.map.nodes)
      if (positions.has(n.id)) n.position = positions.get(n.id)!;
    graph.map.layout.radius = Math.max(
      graph.map.layout.radius,
      previous.layout.radius,
    );
  }
  progress({
    phase: "Ready",
    detail: graph.map.project.name,
    percent: 100,
    files: files.length,
    symbols: graph.map.nodes.length,
  });
  return graph.map;
}
