import ts from "typescript";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import type { CodeMap, MapNode } from "../../shared/types";
import type { FeatureEntry } from "../../shared/workbench";
import { stableId } from "./graph";
export async function enrichFeatures(
  map: CodeMap,
  files: { absolute: string; relative: string; size: number }[],
) {
  const entries: FeatureEntry[] = [],
    sends: { channel: string; node: MapNode; line: number }[] = [],
    handlers = new Map<string, MapNode[]>();
  for (const f of files) {
    if (f.size > 2 * 1024 * 1024) continue;
    const file = map.nodes.find(
      (n) => n.kind === "file" && n.path === f.relative,
    );
    if (!file) continue;
    if (!/\.[cm]?[jt]sx?$/i.test(f.relative)) continue;
    const text = await fs.readFile(f.absolute, "utf8").catch(() => null);
    if (text === null) continue;
    file.fingerprint = createHash("sha256").update(text).digest("hex");
    const sf = ts.createSourceFile(
      f.relative,
      text,
      ts.ScriptTarget.Latest,
      true,
      /x$/.test(f.relative) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const nodes = map.nodes.filter(
      (n) => n.path === f.relative && n.line && n.kind !== "file",
    );
    const owner = (ast: ts.Node) => {
      const pos = sf.getLineAndCharacterOfPosition(ast.getStart(sf));
      return (
        nodes
          .filter(
            (n) =>
              n.line! <= pos.line + 1 && (n.endLine ?? n.line!) >= pos.line + 1,
          )
          .sort(
            (a, b) =>
              a.endLine! - a.line! - (b.endLine! - b.line!) ||
              Math.abs((a.column ?? 1) - pos.character - 1) -
                Math.abs((b.column ?? 1) - pos.character - 1),
          )[0] ?? file
      );
    };
    const target = (ast: ts.Node) =>
      ts.isIdentifier(ast)
        ? nodes.filter(
            (n) =>
              n.name === ast.text && ["function", "method"].includes(n.kind),
          ).length === 1
          ? nodes.find(
              (n) =>
                n.name === ast.text && ["function", "method"].includes(n.kind),
            )
          : undefined
        : ts.isArrowFunction(ast) || ts.isFunctionExpression(ast)
          ? owner(ast)
          : undefined;
    const add = (
      ast: ts.Node,
      name: string,
      kind: string,
      node = owner(ast),
      targets: string[] = [],
    ) => {
      const line = sf.getLineAndCharacterOfPosition(ast.getStart(sf)).line + 1;
      entries.push({
        id: stableId(`${f.relative}:${kind}:${name}:${line}`),
        node_id: node.id,
        name,
        kind,
        path: f.relative,
        line,
        evidence: ast.getText(sf).slice(0, 400),
        target_ids: targets,
      });
    };
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n)) {
        const expr = n.expression.getText(sf),
          last = expr.split(".").pop()!,
          literal = n.arguments[0];
        if (literal && ts.isStringLiteralLike(literal)) {
          const channel = literal.text;
          if (
            /\bipc(?:Renderer|Main)\./.test(expr) &&
            ["invoke", "send", "handle", "on", "once"].includes(last)
          ) {
            const key = "electron:" + channel;
            if (["handle", "on", "once"].includes(last)) {
              const handler = n.arguments[1]
                ? target(n.arguments[1])
                : undefined;
              if (handler) {
                const list = handlers.get(key) ?? [];
                list.push(handler);
                handlers.set(key, list);
                add(n, channel, "IPC handler", handler);
              }
            } else {
              sends.push({
                channel: key,
                node: owner(n),
                line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
              });
              add(n, channel, "IPC request");
            }
          }
          if (
            /^(?:app|router|server)\.(get|post|put|patch|delete|all)$/.test(
              expr,
            )
          ) {
            const handler = target(n.arguments[n.arguments.length - 1]);
            add(
              n,
              `${last.toUpperCase()} ${channel}`,
              "HTTP route",
              handler ?? owner(n),
            );
          }
          if (["command", "registerCommand"].includes(last))
            add(n, channel, "Command");
          if (
            /\.(on|once|addEventListener)$/.test(expr) &&
            !/^ipc/.test(expr)
          ) {
            const handler = n.arguments[1] ? target(n.arguments[1]) : undefined;
            add(n, channel, "Event handler", handler ?? owner(n));
          }
        }
        if (["setInterval", "setTimeout", "queueMicrotask"].includes(expr)) {
          const handler = n.arguments[0] ? target(n.arguments[0]) : undefined;
          add(n, expr, "Background task", handler ?? owner(n));
        }
      }
      if (
        ts.isJsxAttribute(n) &&
        /^on[A-Z]/.test(n.name.getText(sf)) &&
        n.initializer &&
        ts.isJsxExpression(n.initializer) &&
        n.initializer.expression
      ) {
        const handler = target(n.initializer.expression);
        add(
          n,
          `${n.name.getText(sf)}: ${n.initializer.expression.getText(sf).slice(0, 80)}`,
          "UI action",
          handler ?? owner(n),
          handler ? [handler.id] : [],
        );
      }
      ts.forEachChild(n, visit);
    }
    visit(sf);
  }
  for (const send of sends) {
    const targets = handlers.get(send.channel) ?? [];
    for (const target of targets) {
      if (send.node.id === target.id) continue;
      const key = `${send.node.id}|${target.id}|dispatches`;
      if (!map.edges.some((e) => e.id === stableId(key)))
        map.edges.push({
          id: stableId(key),
          source: send.node.id,
          target: target.id,
          kind: "dispatches",
          count: 1,
          path: send.node.path,
          line: send.line,
          evidence: `Explicit Electron channel ${send.channel.slice(9)}`,
        });
    }
    for (const entry of entries)
      if (entry.node_id === send.node.id && entry.kind === "IPC request")
        entry.target_ids = targets.map((t) => t.id);
  }
  map.features = entries.slice(0, 10000);
}
