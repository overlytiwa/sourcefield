import { promises as fs } from "node:fs";
import path from "node:path";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
import { GraphBuilder, stableId } from "./graph";
import { languageFor, type LanguageSpec } from "./languages";
import type { NodeKind, ScanProgress } from "../../shared/types";

type Input = { absolute: string; relative: string; id: string };
type File = Input & {
  spec: LanguageSpec;
  tree: Tree;
  namespace: string;
  lines: string[];
  bindings: Map<string, string[]>;
  reachable: Set<string>;
  using: Set<string>;
};
type Symbol = {
  id: string;
  name: string;
  kind: NodeKind;
  file: File;
  scope: string;
  qualified: string;
  node: Node;
  typeHint?: string;
  definition: boolean;
};
const clean = (s: string) =>
  s
    .replace(/^["'<]|["'>]$/g, "")
    .replace(/::|\\|->/g, ".")
    .replace(/^\$|[?!]$/g, "")
    .trim();
const children = (n: Node) =>
  n.namedChildren.filter((child): child is Node => !!child);
const field = (n: Node, ...names: string[]) =>
  names.map((name) => n.childForFieldName(name)).find((v): v is Node => !!v);
const firstName = (n: Node): Node | undefined => {
  if (
    [
      "simple_identifier",
      "word",
      "identifier",
      "type_identifier",
      "field_identifier",
      "constant",
      "name",
      "variable_name",
    ].includes(n.type)
  )
    return n;
  const preferred = field(n, "name", "declarator", "pattern");
  if (preferred) return firstName(preferred);
  for (const child of children(n)) {
    const found = firstName(child);
    if (found) return found;
  }
  return undefined;
};
const functionTypes = new Set([
  "function_definition",
  "function_declaration",
  "function_item",
  "method_declaration",
  "method_definition",
  "method",
  "singleton_method",
  "constructor_declaration",
  "local_function_statement",
  "function_signature",
  "function_definition_statement",
  "local_function_definition_statement",
]);
const classTypes = new Set([
  "class_declaration",
  "class_definition",
  "class",
  "struct_item",
  "struct_specifier",
  "struct_declaration",
  "struct_type",
  "union_specifier",
  "record_declaration",
  "trait_item",
  "object_definition",
]);
const namespaceTypes = new Set([
  "namespace_definition",
  "namespace_declaration",
  "file_scoped_namespace_declaration",
  "mod_item",
  "module",
]);
const paramTypes = new Set([
  "parameter",
  "parameter_declaration",
  "formal_parameter",
  "simple_parameter",
  "optional_parameter",
  "variadic_parameter",
  "required_parameter",
]);
const variableTypes = new Set([
  "variable_declarator",
  "init_declarator",
  "var_spec",
  "const_spec",
  "let_declaration",
  "const_item",
  "static_item",
  "assignment",
  "assignment_expression",
  "short_var_declaration",
  "property_declaration",
  "variable_declaration",
  "pattern_binding",
]);
const callTypes = new Set([
  "call_expression",
  "method_invocation",
  "invocation_expression",
  "function_call_expression",
  "member_call_expression",
  "scoped_call_expression",
  "call",
  "object_creation_expression",
  "new_expression",
  "command",
  "function_call",
]);
const identifiers = new Set([
  "simple_identifier",
  "word",
  "identifier",
  "type_identifier",
  "field_identifier",
  "constant",
  "name",
  "variable_name",
]);

let parserReady: Promise<void> | undefined;
const grammarCache = new Map<string, Language>();
export async function analyzePolyglot(
  root: string,
  inputs: Input[],
  graph: GraphBuilder,
  progress: (p: ScanProgress) => void,
) {
  await (parserReady ??= Parser.init());
  const grammars = grammarCache;
  const files: File[] = [],
    symbols = new Map<string, Symbol>();
  const scopes = new Map<string, Map<string, string[]>>(),
    parents = new Map<string, string>(),
    astScope = new Map<string, string>();
  const astSymbol = new Map<string, string>(),
    declarationNames = new Set<string>(),
    qualified = new Map<string, string[]>();
  const astKey = (file: File, n: Node) =>
    `${file.id}:${n.startIndex}:${n.type}`;
  const append = (map: Map<string, string[]>, name: string, id: string) => {
    const list = map.get(name) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(name, list);
  };
  let goModule = "";
  try {
    goModule =
      (await fs.readFile(path.join(root, "go.mod"), "utf8")).match(
        /^module\s+(\S+)/m,
      )?.[1] ?? "";
  } catch {
    /* optional */
  }
  function getNamespace(input: Input, spec: LanguageSpec, text: string) {
    if (spec.name === "Go")
      return path.posix.dirname(input.relative).replace(/^\.$/, "");
    if (spec.name === "Kotlin" || spec.name === "Scala")
      return text.match(/\bpackage\s+([\w.]+)/)?.[1] ?? "";
    if (spec.name === "Java")
      return text.match(/\bpackage\s+([\w.]+)\s*;/)?.[1] ?? "";
    if (spec.name === "C#" || spec.name === "PHP")
      return clean(text.match(/\bnamespace\s+([\w.\\]+)/)?.[1] ?? "");
    if (spec.name === "Rust")
      return (
        "crate." +
        input.relative
          .replace(/^src\//, "")
          .replace(/(?:\/mod|\/lib|\/main)?\.rs$/, "")
          .replace(/^(main|lib)$/, "")
          .replace(/\//g, ".")
      );
    return "";
  }
  function add(
    file: File,
    n: Node,
    nameNode: Node,
    kind: NodeKind,
    owner: string,
    scope: string,
    prefix: string,
  ) {
    if (symbols.size >= 100000) return;
    const name = clean(nameNode.text);
    if (!name || name.length > 400) return;
    const id = `p:${stableId(`${file.relative}:${nameNode.startIndex}:${kind}:${name}`)}`;
    if (symbols.has(id)) return symbols.get(id);
    const line = n.startPosition.row + 1,
      endLine = n.endPosition.row + 1;
    const exported =
      (owner === file.id && !/^static\b/.test(n.text)) ||
      (file.spec.name === "Go" && /^[A-Z]/.test(name)) ||
      /^(?:pub|public)\b/.test(n.text);
    graph.node(id, name, kind, file.relative, {
      parent: owner,
      line,
      column: nameNode.startPosition.column + 1,
      endLine,
      language: file.spec.name,
      exported,
      fingerprint: stableId(n.text),
      signature: ["function", "method", "class", "interface", "type"].includes(
        kind,
      )
        ? n.text.split(/\n|\{/)[0].trim().slice(0, 400)
        : undefined,
      excerpt: file.lines
        .slice(line - 1, Math.min(endLine, line + 11))
        .join("\n")
        .slice(0, 2400),
    });
    const typeNode =
      field(n, "type") ?? (n.parent ? field(n.parent, "type") : undefined);
    const symbol: Symbol = {
      id,
      name,
      kind,
      file,
      scope,
      qualified: [prefix, name].filter(Boolean).join(".").replace(/\.+/g, "."),
      node: n,
      typeHint: typeNode?.text.replace(/[?*&\[\]]/g, "").trim(),
      definition:
        !!field(n, "body") || ["function_item", "method"].includes(n.type),
    };
    symbols.set(id, symbol);
    astSymbol.set(astKey(file, n), id);
    function markName(node: Node) {
      declarationNames.add(astKey(file, node));
      for (const child of children(node)) markName(child);
    }
    markName(nameNode);
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    append(scopes.get(scope)!, name, id);
    append(qualified, `${file.spec.name}:${symbol.qualified}`, id);
    if (exported)
      graph.edge(file.id, id, "exports", { path: file.relative, line });
    return symbol;
  }
  function collect(
    file: File,
    n: Node,
    scope: string,
    owner: string,
    prefix: string,
  ) {
    let nextScope = scope,
      nextOwner = owner,
      nextPrefix = prefix;
    if (file.spec.name === "Dart" && n.type === "function_body") {
      const previous = n.previousNamedSibling;
      const signature =
        previous?.type === "method_signature"
          ? children(previous)[0]
          : previous;
      const id = signature ? astSymbol.get(astKey(file, signature)) : undefined;
      if (id) {
        nextScope = id;
        nextOwner = id;
        astSymbol.set(astKey(file, n), id);
      }
    }

    let nameNode = field(n, "name");
    if (!nameNode && ["Kotlin", "Lua"].includes(file.spec.name))
      nameNode = children(n).find((c) =>
        ["simple_identifier", "type_identifier", "identifier"].includes(c.type),
      );
    let kind: NodeKind | undefined;
    if (n.type === "impl_item") {
      const type = field(n, "type");
      const ownerSymbol = [...symbols.values()].find(
        (s) =>
          s.file.id === file.id &&
          s.name === type?.text &&
          ["class", "type"].includes(s.kind),
      );
      if (ownerSymbol) {
        nextOwner = ownerSymbol.id;
        nextScope = ownerSymbol.id;
        nextPrefix = ownerSymbol.qualified;
        if (!scopes.has(nextScope)) scopes.set(nextScope, new Map());
        parents.set(nextScope, scope);
      }
    }
    if (functionTypes.has(n.type)) {
      nameNode ??= firstName(field(n, "declarator") ?? n);
      kind =
        symbols.get(owner)?.kind === "class" ||
        /method|constructor/.test(n.type)
          ? "method"
          : "function";
    } else if (classTypes.has(n.type)) {
      nameNode ??= firstName(n);
      kind = "class";
    } else if (["interface_declaration", "interface_type"].includes(n.type))
      kind = "interface";
    else if (
      ["enum_declaration", "enum_item", "enum_specifier"].includes(n.type)
    )
      kind = "enum";
    else if (
      [
        "type_spec",
        "type_item",
        "type_alias_declaration",
        "type_definition",
      ].includes(n.type)
    ) {
      nameNode ??= firstName(field(n, "declarator") ?? n);
      kind = "type";
    } else if (namespaceTypes.has(n.type)) {
      nameNode ??= firstName(n);
      kind = "namespace";
    } else if (paramTypes.has(n.type)) {
      nameNode ??= firstName(field(n, "declarator", "pattern") ?? n);
      kind = "parameter";
    } else if (variableTypes.has(n.type)) {
      nameNode ??= firstName(field(n, "declarator", "pattern", "left") ?? n);
      kind = symbols.get(owner)?.kind === "class" ? "property" : "variable";
    } else if (
      [
        "field_declaration",
        "field_definition",
        "property_declaration",
        "property_element",
      ].includes(n.type)
    ) {
      if (nameNode) kind = "property";
    } else if (
      n.type === "function_declarator" &&
      n.parent?.type !== "function_definition"
    ) {
      nameNode = firstName(field(n, "declarator") ?? n);
      kind = "function";
    }
    if (kind && nameNode) {
      if (file.spec.name === "Go" && n.type === "method_declaration") {
        const receiver = field(n, "receiver");
        const typeName = receiver?.text
          .replace(/[()]/g, "")
          .trim()
          .split(/\s+/)
          .pop()
          ?.replace(/\*/g, "");
        const type = [...symbols.values()].find(
          (s) =>
            s.file.id === file.id &&
            s.name === typeName &&
            ["class", "type"].includes(s.kind),
        );
        if (type) {
          owner = type.id;
          scope = type.id;
          prefix = type.qualified;
          if (!scopes.has(scope)) scopes.set(scope, new Map());
          parents.set(scope, file.id);
        }
      }
      const symbol = add(
        file,
        n,
        nameNode,
        kind,
        owner,
        scope,
        kind === "namespace" && clean(nameNode.text) === file.namespace
          ? ""
          : prefix,
      );
      if (
        symbol &&
        [
          "function",
          "method",
          "class",
          "interface",
          "enum",
          "namespace",
        ].includes(kind)
      ) {
        nextOwner = symbol.id;
        nextScope = symbol.id;
        parents.set(nextScope, scope);
        scopes.set(nextScope, new Map());
        if (["class", "interface", "namespace", "enum"].includes(kind))
          nextPrefix = symbol.qualified;
      }
    } else if (
      ["block", "compound_statement", "statement_block"].includes(n.type)
    ) {
      nextScope = `scope:${file.id}:${n.startIndex}`;
      parents.set(nextScope, scope);
      scopes.set(nextScope, new Map());
    }
    astScope.set(astKey(file, n), nextScope);
    if (n.type === "method_parameters")
      for (const child of children(n))
        if (child.type === "identifier")
          add(
            file,
            child,
            child,
            "parameter",
            nextOwner,
            nextScope,
            nextPrefix,
          );
    for (const child of children(n))
      collect(file, child, nextScope, nextOwner, nextPrefix);
  }
  try {
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const hasCpp = inputs.some((f) =>
        /\.(cpp|cc|cxx|hpp|hh|hxx)$/.test(f.relative),
      );
      const spec =
        input.relative.endsWith(".h") && hasCpp
          ? { name: "C++", grammar: "cpp", extensions: [".h"] }
          : languageFor(input.relative)!;
      graph.byId.get(input.id)!.language = spec.name;
      progress({
        phase: `Analyzing ${spec.name}`,
        detail: input.relative,
        percent: 68 + (i / inputs.length) * 10,
      });
      try {
        if (!grammars.has(spec.grammar))
          grammars.set(
            spec.grammar,
            await Language.load(
              path.join(
                path.dirname(require.resolve("tree-sitter-wasms/package.json")),
                "out",
                `tree-sitter-${spec.grammar}.wasm`,
              ),
            ),
          );
        const parser = new Parser();
        parser.setLanguage(grammars.get(spec.grammar)!);
        const text = await fs.readFile(input.absolute, "utf8");
        const tree = parser.parse(text);
        parser.delete();
        if (!tree) throw new Error("Parser returned no syntax tree.");
        const file: File = {
          ...input,
          spec,
          tree,
          namespace: getNamespace(input, spec, text).replace(/\.$/, ""),
          lines: text.split(/\r?\n/),
          bindings: new Map(),
          reachable: new Set([input.id]),
          using: new Set(),
        };
        scopes.set(file.id, new Map());
        files.push(file);
        collect(file, tree.rootNode, file.id, file.id, file.namespace);
        if (tree.rootNode.hasError) {
          graph.byId.get(file.id)!.status = "partial";
          graph.issue({
            kind: "parse",
            path: file.relative,
            name: `${spec.name} syntax issue`,
            reason:
              "The parser recovered from unsupported or incomplete syntax. Available declarations are still shown.",
          });
        }
      } catch (e) {
        graph.byId.get(input.id)!.status = "skipped";
        graph.issue({
          kind: "skipped",
          path: input.relative,
          name: `${spec.name} parser unavailable`,
          reason: e instanceof Error ? e.message : "Parser failed.",
        });
      }
    }
    const byPath = new Map(files.map((f) => [f.relative, f]));
    const unique = (ids: string[] | undefined) => {
      const all = [...new Set(ids ?? [])];
      const definitions = all.filter((id) => symbols.get(id)?.definition);
      return definitions.length === 1
        ? definitions[0]
        : all.length === 1
          ? all[0]
          : undefined;
    };
    const findQualified = (file: File, name: string) =>
      unique(qualified.get(`${file.spec.name}:${clean(name)}`));
    const allInNamespace = (file: File, ns: string) =>
      files.filter((f) => f.spec.name === file.spec.name && f.namespace === ns);
    function importTarget(file: File, raw: string, n: Node, alias?: string) {
      const name = clean(raw.replace(/;$/, ""));
      let targets: File[] = [],
        symbol: string | undefined;
      if (file.spec.name === "Go") {
        const dir =
          goModule && name.startsWith(goModule + "/")
            ? name.slice(goModule.length + 1)
            : name === goModule
              ? ""
              : undefined;
        if (dir !== undefined) targets = allInNamespace(file, dir);
        if (targets.length) {
          const local =
            alias ||
            children(targets[0].tree.rootNode).find(
              (n) => n.type === "package_clause",
            )?.namedChildren[0]?.text ||
            path.posix.basename(name);
          file.bindings.set(
            local,
            targets.map((t) => t.id),
          );
        }
      } else if (
        ["C", "C++", "Ruby", "PHP"].includes(file.spec.name) &&
        (file.spec.name === "Ruby" || /[/.]|require|include/.test(raw))
      ) {
        const base = path.posix.normalize(
          path.posix.join(path.posix.dirname(file.relative), name),
        );
        const target =
          byPath.get(base) ??
          byPath.get(`${base}.rb`) ??
          byPath.get(`${base}.php`);
        if (target) targets = [target];
      }
      if (!targets.length) {
        let q = name;
        if (file.spec.name === "Rust") {
          q = q
            .replace(/^self\./, `${file.namespace}.`)
            .replace(
              /^super\./,
              `${file.namespace.split(".").slice(0, -1).join(".")}.`,
            );
        }
        symbol = findQualified(file, q);
        if (symbol) targets = [symbols.get(symbol)!.file];
        else targets = allInNamespace(file, q.replace(/\.\*$/, ""));
        if (symbol) file.bindings.set(alias ?? q.split(".").pop()!, [symbol]);
        else if (targets.length && !name.endsWith(".*"))
          file.bindings.set(
            alias ?? name.split(".").pop()!,
            targets.map((t) => t.id),
          );
        if (name.endsWith(".*") || file.spec.name === "C#")
          file.using.add(name.replace(/\.\*$/, ""));
      }
      const location = { path: file.relative, line: n.startPosition.row + 1 };
      if (targets.length)
        for (const target of targets) {
          file.reachable.add(target.id);
          graph.edge(file.id, target.id, "imports", location);
        }
      else
        graph.issue({
          kind: "external",
          path: file.relative,
          line: location.line,
          source: file.id,
          relationship: "imports",
          name: raw.slice(0, 180),
          reason:
            "Import is outside the scanned graph or cannot be resolved from static paths.",
        });
    }
    function imports(file: File, n: Node) {
      if (n.type === "import_spec") {
        const p = field(n, "path");
        if (p) importTarget(file, p.text, n, field(n, "name")?.text);
      }
      if (n.type === "preproc_include") {
        const p = field(n, "path");
        if (p) importTarget(file, p.text, n);
      }
      if (n.type === "import_declaration" && file.spec.name === "Java")
        importTarget(
          file,
          n.text.replace(/^import\s+(?:static\s+)?|;$/g, ""),
          n,
        );
      if (n.type === "using_directive" && file.spec.name === "C#")
        importTarget(
          file,
          n.text.replace(/^using\s+(?:static\s+)?|;$/g, ""),
          n,
        );
      if (n.type === "use_declaration") {
        const value = n.text.replace(/^use\s+|;$/g, "");
        const grouped = value.match(/^(.*?)\{(.*?)\}$/);
        const names = grouped
          ? grouped[2].split(",").map((s) => grouped[1] + s.trim())
          : [value];
        for (const name of names) {
          const [target, alias] = name.split(/\s+as\s+/);
          importTarget(file, target, n, alias);
        }
      }
      if (n.type === "namespace_use_clause") {
        const [target, alias] = n.text.split(/\s+as\s+/);
        importTarget(file, target, n, alias);
      }
      if (
        n.type === "call" &&
        /^(?:require_relative|require)\s*\(?["']/.test(n.text)
      ) {
        const value = n.text.match(/["']([^"']+)["']/)?.[1];
        if (value) importTarget(file, value, n);
      }
      for (const child of children(n)) imports(file, child);
    }
    files.forEach((f) => imports(f, f.tree.rootNode));
    // Includes and explicit module imports are transitive for name visibility.
    for (let step = 0; step < 5; step++)
      for (const f of files)
        for (const id of [...f.reachable]) {
          const target = files.find((t) => t.id === id);
          if (target)
            for (const other of target.reachable) f.reachable.add(other);
        }
    function resolve(
      file: File,
      scope: string,
      raw: string,
      seen = new Set<string>(),
    ): string | undefined {
      const name = clean(raw)
        .replace(/^this\.|^self\.|^\$this\./, "")
        .replace(/<[^>]+>/g, "");
      if (!name || seen.has(`${scope}:${name}`)) return;
      seen.add(`${scope}:${name}`);
      if (name.includes(".")) {
        const direct =
          findQualified(file, name) ??
          findQualified(file, `${file.namespace}.${name}`);
        if (direct) return direct;
        const parts = name.split("."),
          member = parts.pop()!,
          baseName = parts.join(".");
        const bound = file.bindings.get(baseName);
        if (bound) {
          const candidates = bound.flatMap((id) =>
            symbols.has(id)
              ? (qualified.get(
                  `${file.spec.name}:${symbols.get(id)!.qualified}.${member}`,
                ) ?? [])
              : [...(scopes.get(id)?.get(member) ?? [])],
          );
          const target = unique(candidates);
          if (target) return target;
        }
        const base = resolve(file, scope, baseName, seen),
          record = base ? symbols.get(base) : undefined;
        if (record?.typeHint) {
          const type = resolve(file, scope, record.typeHint, seen);
          if (type) return unique(scopes.get(type)?.get(member));
        }
        if (base) return unique(scopes.get(base)?.get(member));
        return;
      }
      let current: string | undefined = scope;
      while (current) {
        const candidates = scopes.get(current)?.get(name);
        if (candidates?.length) return unique(candidates);
        current = parents.get(current);
      }
      if (file.bindings.has(name)) return unique(file.bindings.get(name));
      const namespaces = [file.namespace, ...file.using];
      const inNamespace = namespaces.flatMap(
        (ns) =>
          qualified.get(
            `${file.spec.name}:${[ns, name].filter(Boolean).join(".")}`,
          ) ?? [],
      );
      const allowed = inNamespace.filter((id) => {
        const s = symbols.get(id)!;
        if (
          [
            "Go",
            "Java",
            "C#",
            "PHP",
            "Rust",
            "Kotlin",
            "Scala",
            "Swift",
            "Dart",
            "Bash",
          ].includes(file.spec.name)
        )
          return (
            s.scope === s.file.id ||
            ["class", "interface", "namespace"].includes(s.kind)
          );
        return file.reachable.has(s.file.id);
      });
      return unique(allowed);
    }
    function trace(file: File, n: Node, scope: string, owner: string) {
      scope = astScope.get(astKey(file, n)) ?? scope;
      const id = astSymbol.get(astKey(file, n)),
        symbol = id ? symbols.get(id) : undefined;
      if (
        symbol &&
        ["function", "method", "class", "namespace", "interface"].includes(
          symbol.kind,
        )
      )
        owner = symbol.id;
      const location = {
        path: file.relative,
        line: n.startPosition.row + 1,
        column: n.startPosition.column + 1,
      };
      const problem = (
        relationship: "calls" | "inherits" | "references",
        name: string,
      ) =>
        graph.issue({
          kind: "unresolved",
          source: owner,
          relationship,
          ...location,
          name: name.slice(0, 180),
          reason:
            "Target is dynamic, ambiguous, external, or needs compiler build information. No inferred edge was added.",
        });
      if (
        file.spec.name === "Dart" &&
        n.type === "selector" &&
        children(n).some((c) => c.type === "argument_part") &&
        n.previousNamedSibling?.type === "identifier"
      ) {
        const name = n.previousNamedSibling.text;
        const target = resolve(file, scope, name);
        if (target) graph.edge(owner, target, "calls", location);
        else problem("calls", name);
      }
      if (callTypes.has(n.type)) {
        let expr = field(n, "function", "name", "method", "type");
        if (!expr && ["Kotlin", "Swift"].includes(file.spec.name))
          expr = children(n)[0];
        const receiver = field(n, "object", "receiver", "scope");
        if (expr) {
          const text = (receiver ? receiver.text + "." : "") + expr.text;
          if (!/^(require|require_relative)$/.test(text)) {
            const target = resolve(file, scope, text);
            if (
              target &&
              ["function", "method", "class"].includes(
                symbols.get(target)?.kind ?? "",
              )
            )
              graph.edge(owner, target, "calls", location);
            else problem("calls", text);
          }
        }
      }
      if (symbol && ["class", "interface"].includes(symbol.kind)) {
        const base =
          field(n, "superclass", "bases", "super_interfaces") ??
          children(n).find((c) =>
            ["base_list", "superclass", "super_interfaces"].includes(c.type),
          );
        if (base)
          for (const item of children(base)) {
            const target = resolve(
              file,
              parents.get(scope) ?? file.id,
              item.text,
            );
            if (target) graph.edge(symbol.id, target, "inherits", location);
            else problem("inherits", item.text);
          }
      }
      if (
        identifiers.has(n.type) &&
        !children(n).length &&
        !declarationNames.has(astKey(file, n))
      ) {
        const parentType = n.parent?.type ?? "";
        if (
          !/import|use_declaration|namespace_use|package_clause|package_declaration|namespace_name/.test(
            parentType,
          )
        ) {
          const target = resolve(file, scope, n.text);
          if (target && symbols.has(target))
            graph.edge(owner, target, "references", location);
          else if (
            !/^(true|false|null|nil|self|this|super)$/.test(n.text) &&
            !/call|invocation|field_expression|selector_expression|member_access/.test(
              parentType,
            )
          )
            problem("references", n.text);
        }
      }
      for (const child of children(n)) trace(file, child, scope, owner);
    }
    for (const f of files) trace(f, f.tree.rootNode, f.id, f.id);
  } finally {
    for (const f of files) f.tree.delete();
  }
}
