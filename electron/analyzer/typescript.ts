import ts from 'typescript';
import path from 'node:path';
import { GraphBuilder, stableId } from './graph';
import type { NodeKind, ScanProgress } from '../../shared/types';

type InputFile = { absolute: string; relative: string; id: string };
export async function analyzeTypeScript(root: string, files: InputFile[], graph: GraphBuilder, progress: (p: ScanProgress) => void) {
  progress({ phase: 'Analyzing symbols', detail: 'JavaScript · TypeScript', percent: 12 });
  let options: ts.CompilerOptions = { allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve, allowImportingTsExtensions: true, resolveJsonModule: true, maxNodeModuleJsDepth: 0 };
  // Config is parsed as data. No plugins, build scripts, or project code run.
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json') ?? ts.findConfigFile(root, ts.sys.fileExists, 'jsconfig.json');
  if (configPath && path.dirname(configPath) === root) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!config.error) {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
      options = { ...parsed.options, ...options, baseUrl: parsed.options.baseUrl, paths: parsed.options.paths };
    }
  }
  const program = ts.createProgram(files.map(f => f.absolute), options);
  const checker = program.getTypeChecker();
  const normalized = (p: string) => path.resolve(p);
  const input = new Map(files.map(f => [normalized(f.absolute), f]));
  const declIds = new Map<ts.Node, string>();
  const symbolIds = new Map<ts.Symbol, string>();
  const lineCache = new Map<ts.SourceFile, string[]>();
  let symbols = 0, warnedLimit = false;
  const MAX_SYMBOLS = 100000;
  function sourceInfo(n: ts.Node) {
    const sf = n.getSourceFile(), f = input.get(normalized(sf.fileName));
    const point = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    return { sf, file: f, path: f?.relative ?? sf.fileName, line: point.line + 1, column: point.character + 1 };
  }
  function aliased(s: ts.Symbol | undefined): ts.Symbol | undefined {
    const seen = new Set<ts.Symbol>();
    while (s && (s.flags & ts.SymbolFlags.Alias) && !seen.has(s)) { seen.add(s); try { s = checker.getAliasedSymbol(s); } catch { break; } }
    return s;
  }
  function resolveSymbol(s: ts.Symbol | undefined): string | undefined {
    if (!s) return;
    s = aliased(s) ?? s;
    if (symbolIds.has(s)) return symbolIds.get(s);
    for (const d of s.declarations ?? []) {
      if (declIds.has(d)) return declIds.get(d);
      if (ts.isSourceFile(d)) return input.get(normalized(d.fileName))?.id;
    }
  }
  function resolve(n: ts.Node): string | undefined {
    return declIds.get(n) ?? resolveSymbol(checker.getSymbolAtLocation(n));
  }
  function add(n: ts.Node, name: string, kind: NodeKind, parent: string, nameNode?: ts.Node) {
    if (++symbols > MAX_SYMBOLS) {
      if (!warnedLimit) { graph.issue({ kind: 'limit', path: '', name: 'Symbol limit', reason: 'Symbol analysis stopped at 100,000 declarations.' }); warnedLimit = true; }
      return parent;
    }
    const info = sourceInfo(n); if (!info.file) return parent;
    const id = `s:${stableId(`${info.path}:${n.getStart(info.sf)}:${kind}:${name}`)}`;
    const endLine = info.sf.getLineAndCharacterOfPosition(n.end).line + 1;
    let lines = lineCache.get(info.sf);
    if (!lines) { lines = info.sf.text.split(/\r?\n/); lineCache.set(info.sf, lines); }
    const excerpt = lines.slice(info.line - 1, Math.min(endLine, info.line + 11)).join('\n').slice(0, 2400);
    let signature = '';
    try { if (nameNode) signature = checker.typeToString(checker.getTypeAtLocation(nameNode), nameNode, ts.TypeFormatFlags.NoTruncation).slice(0, 400); } catch { /* malformed source */ }
    const exported = !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
    graph.node(id, name, kind, info.path, { parent, line: info.line, column: info.column, endLine,
      language: /\.[cm]?tsx?$/.test(info.path) ? 'TypeScript' : 'JavaScript', signature, excerpt, exported });
    declIds.set(n, id);
    if (nameNode) { declIds.set(nameNode, id); const symbol = checker.getSymbolAtLocation(nameNode); if (symbol) symbolIds.set(symbol, id); }
    return id;
  }
  const isCallable = (n: ts.Node) => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n)
    || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);
  function declaration(n: ts.Node, parent: string): void {
    let scope = parent;
    const named = n as ts.NamedDeclaration;
    const name = named.name?.getText(n.getSourceFile());
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) scope = add(n, name ?? 'default class', 'class', parent, named.name);
    else if (ts.isInterfaceDeclaration(n)) scope = add(n, name!, 'interface', parent, n.name);
    else if (ts.isTypeAliasDeclaration(n)) scope = add(n, name!, 'type', parent, n.name);
    else if (ts.isEnumDeclaration(n)) scope = add(n, name!, 'enum', parent, n.name);
    else if (ts.isEnumMember(n)) scope = add(n, name!, 'property', parent, n.name);
    else if (ts.isModuleDeclaration(n)) scope = add(n, name!, 'namespace', parent, n.name);
    else if (ts.isFunctionDeclaration(n)) scope = add(n, name ?? 'default function', 'function', parent, n.name);
    else if (ts.isMethodDeclaration(n) || ts.isMethodSignature(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) scope = add(n, name!, 'method', parent, named.name);
    else if (ts.isConstructorDeclaration(n)) scope = add(n, 'constructor', 'method', parent);
    else if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) {
      if (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) {
        const init = n.initializer;
        const kind = ts.isParameter(n) ? 'parameter' : init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? 'function' : 'variable';
        scope = add(n, name!, kind, parent, n.name);
        if (init && isCallable(init)) declIds.set(init, scope);
      }
    } else if (ts.isPropertyDeclaration(n) || ts.isPropertySignature(n) || ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      scope = add(n, name!, 'property', parent, named.name);
      if ('initializer' in n && n.initializer && isCallable(n.initializer)) declIds.set(n.initializer, scope);
    } else if (ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n) && n.name || ts.isImportEqualsDeclaration(n)) {
      const local = (n as ts.ImportSpecifier).name;
      if (local) scope = add(n, local.text, 'import', parent, local);
    } else if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      if (declIds.has(n)) scope = declIds.get(n)!;
      else scope = add(n, ts.isFunctionExpression(n) && n.name ? n.name.text : `(callback ${sourceInfo(n).line})`, 'function', parent, named.name);
    }
    ts.forEachChild(n, child => declaration(child, scope));
  }
  for (let i = 0; i < files.length; i++) {
    const f = files[i], sf = program.getSourceFile(f.absolute);
    if (!sf) continue;
    declIds.set(sf, f.id);
    declaration(sf, f.id);
    const diagnostics = program.getSyntacticDiagnostics(sf);
    if (diagnostics.length) graph.byId.get(f.id)!.status = 'partial';
    for (const d of diagnostics) graph.issue({ kind: 'parse', path: f.relative,
      line: d.start === undefined ? undefined : sf.getLineAndCharacterOfPosition(d.start).line + 1,
      name: 'Syntax issue', reason: ts.flattenDiagnosticMessageText(d.messageText, ' ') });
    if (i % 15 === 0) progress({ phase: 'Analyzing symbols', detail: f.relative, percent: 15 + i / files.length * 25, symbols });
  }
  function owning(n: ts.Node, callableOnly = false): string {
    let p: ts.Node | undefined = n.parent;
    while (p) { if ((!callableOnly || isCallable(p) || ts.isSourceFile(p)) && declIds.has(p)) return declIds.get(p)!; p = p.parent; }
    return input.get(normalized(n.getSourceFile().fileName))!.id;
  }
  function problem(n: ts.Node, source: string, relationship: 'calls' | 'imports' | 'inherits' | 'references', label: string, symbol?: ts.Symbol) {
    const info = sourceInfo(n), actual = aliased(symbol);
    const external = actual?.declarations?.some(d => !input.has(normalized(d.getSourceFile().fileName))) || false;
    graph.issue({ kind: external ? 'external' : 'unresolved', path: info.path, line: info.line, source, relationship, name: label.slice(0, 180),
      reason: external ? 'Target is outside the scanned project (dependency, platform API, or ignored file).' : 'Static analysis cannot resolve this target. It may be dynamic or unavailable.' });
  }
  function location(n: ts.Node) { const { path, line, column } = sourceInfo(n); return { path, line, column }; }
  function importLink(n: ts.Node, literal: ts.Expression, sourceFile: ts.SourceFile) {
    if (!ts.isStringLiteralLike(literal)) return;
    const source = input.get(normalized(sourceFile.fileName))!.id;
    let target = resolveSymbol(checker.getSymbolAtLocation(literal));
    if (!target) {
      const result = ts.resolveModuleName(literal.text, sourceFile.fileName, options, ts.sys).resolvedModule;
      if (result) target = input.get(normalized(result.resolvedFileName))?.id;
    }
    if (target) graph.edge(source, target, 'imports', location(n));
    else problem(literal, source, 'imports', literal.text, checker.getSymbolAtLocation(literal));
  }
  function isReference(n: ts.Identifier) {
    if (declIds.has(n)) return false;
    const p = n.parent;
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
    if ((ts.isPropertyAccessExpression(p) && p.expression === n) || ts.isQualifiedName(p) && p.left === n) return true;
    if ('name' in p && (p as ts.NamedDeclaration).name === n && !ts.isPropertyAccessExpression(p) && !ts.isShorthandPropertyAssignment(p)) return false;
    return !ts.isLabeledStatement(p) && !ts.isBreakStatement(p) && !ts.isContinueStatement(p);
  }
  for (let i = 0; i < files.length; i++) {
    const f = files[i], sf = program.getSourceFile(f.absolute); if (!sf) continue;
    function links(n: ts.Node) {
      if (ts.isImportDeclaration(n)) importLink(n, n.moduleSpecifier, sf!);
      if (ts.isExportDeclaration(n) && n.moduleSpecifier) importLink(n, n.moduleSpecifier, sf!);
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(n.expression) && n.expression.text === 'require') && n.arguments[0]) {
          importLink(n, n.arguments[0], sf!);
        } else {
          const expr = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression;
          let target: string | undefined;
          try { const d = checker.getResolvedSignature(n)?.declaration; if (d) target = declIds.get(d); } catch { /* incomplete code */ }
          target ??= resolve(expr);
          const source = owning(n, true);
          if (target) graph.edge(source, target, 'calls', location(n));
          else problem(n, source, 'calls', n.expression.getText(sf).slice(0, 180), checker.getSymbolAtLocation(expr));
        }
      }
      if (ts.isExpressionWithTypeArguments(n) && ts.isHeritageClause(n.parent)) {
        const source = owning(n), target = resolve(n.expression);
        if (target) graph.edge(source, target, 'inherits', location(n));
        else problem(n, source, 'inherits', n.expression.getText(sf), checker.getSymbolAtLocation(n.expression));
      }
      if (ts.isIdentifier(n) && isReference(n)) {
        const symbol = checker.getSymbolAtLocation(n), target = resolveSymbol(symbol), source = owning(n);
        if (target) graph.edge(source, target, 'references', location(n));
        else problem(n, source, 'references', n.text, symbol);
      }
      ts.forEachChild(n, links);
    }
    links(sf);
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (moduleSymbol) for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const id = resolveSymbol(exported);
      if (id && id !== f.id) { graph.edge(f.id, id, 'exports', location(sf)); const node = graph.byId.get(id); if (node) node.exported = true; }
    }
    if (i % 10 === 0) progress({ phase: 'Tracing connections', detail: f.relative, percent: 42 + i / files.length * 32, symbols });
  }
}
