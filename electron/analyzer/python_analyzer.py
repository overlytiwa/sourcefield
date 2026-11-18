"""Static Python analysis. Reads ASTs only; never imports or executes a project."""
import ast
import hashlib
import json
import pathlib
import sys

data = json.load(sys.stdin)
root = pathlib.Path(data['root'])
nodes, edges, issues = [], [], []
modules, trees, scopes, parent_scopes, ast_ids, node_by_id = {}, {}, {}, {}, {}, {}
imports, assignments, class_for_scope = {}, {}, {}

def issue(kind, file, name, reason, line=None, source=None, relationship=None):
    if len(issues) < 100000:
        issues.append(dict(kind=kind, path=file, name=name, reason=reason, line=line, source=source, relationship=relationship))

def link(a, b, kind, file, line):
    if a != b or kind == 'calls':
        edges.append(dict(source=a, target=b, kind=kind, path=file, line=line))

def module_name(file):
    value = str(pathlib.PurePosixPath(file).with_suffix('')).replace('/', '.')
    return value.removesuffix('.__init__') if value != '__init__' else ''

for item in data['files']:
    modules[module_name(item['relative'])] = item['id']
    modules[root.name + ('.' + module_name(item['relative']) if module_name(item['relative']) else '')] = item['id']
    scopes[item['id']] = {}

class Collector(ast.NodeVisitor):
    def __init__(self, item, text):
        self.file, self.scope, self.text = item['relative'], item['id'], text
        self.lines = text.splitlines()

    def add(self, n, name, kind):
        if len(nodes) >= 100000:
            raise ValueError('Python symbol limit of 100,000 reached')
        key = f"{self.file}:{getattr(n, 'lineno', 1)}:{getattr(n, 'col_offset', 0)}:{name}:{kind}"
        ident = 'py:' + hashlib.sha1(key.encode()).hexdigest()[:20]
        start, end = getattr(n, 'lineno', 1), getattr(n, 'end_lineno', 1)
        record = dict(id=ident, name=name, kind=kind, path=self.file, line=start,
                      endLine=end, column=getattr(n, 'col_offset', 0) + 1, parent=self.scope,
                      language='Python', position=[0, 0, 0], degree=0,
                      excerpt='\n'.join(self.lines[start-1:min(end, start+11)])[:2400])
        nodes.append(record)
        node_by_id[ident] = record
        # Reassignments retain a conservative first lexical binding.
        scopes.setdefault(self.scope, {}).setdefault(name, ident)
        ast_ids[id(n)] = ident
        return ident

    def definition(self, n, kind):
        ident = self.add(n, n.name, kind)
        outer = self.scope
        parent_scopes[ident] = outer
        scopes[ident] = {}
        if kind == 'class':
            class_for_scope[ident] = ident
        elif outer in class_for_scope:
            class_for_scope[ident] = class_for_scope[outer]
        self.scope = ident
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            record = node_by_id[ident]
            record['signature'] = ('async ' if isinstance(n, ast.AsyncFunctionDef) else '') + 'def ' + n.name + '(' + ast.unparse(n.args) + ')'
            for arg in n.args.posonlyargs + n.args.args + n.args.kwonlyargs + ([n.args.vararg] if n.args.vararg else []) + ([n.args.kwarg] if n.args.kwarg else []):
                self.add(arg, arg.arg, 'parameter')
        for stmt in n.body:
            self.visit(stmt)
        self.scope = outer

    def visit_ClassDef(self, n): self.definition(n, 'class')
    def visit_FunctionDef(self, n): self.definition(n, 'method' if self.scope in class_for_scope and node_by_id.get(self.scope, {}).get('kind') == 'class' else 'function')
    def visit_AsyncFunctionDef(self, n): self.visit_FunctionDef(n)

    def bind(self, target, value=None):
        if isinstance(target, ast.Name):
            existing = scopes[self.scope].get(target.id)
            ident = existing or self.add(target, target.id, 'variable')
            ast_ids[id(target)] = ident
            if value is not None: assignments[ident] = (value, self.scope)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for child in target.elts: self.bind(child)

    def visit_Assign(self, n):
        for target in n.targets: self.bind(target, n.value)
        self.visit(n.value)

    def visit_AnnAssign(self, n):
        self.bind(n.target, n.value)
        if n.value: self.visit(n.value)

    def visit_For(self, n):
        self.bind(n.target)
        self.generic_visit(n)
    visit_AsyncFor = visit_For

    def visit_Import(self, n):
        for alias in n.names:
            name = alias.asname or alias.name.split('.')[0]
            ident = self.add(n, name, 'import')
            imports[ident] = (alias.name if alias.asname else alias.name.split('.')[0], None)
            ast_ids.pop(id(n), None)

    def visit_ImportFrom(self, n):
        package = module_name(self.file).split('.')
        if not self.file.endswith('__init__.py'): package = package[:-1]
        base = '.'.join(package[:len(package)-n.level+1]) if n.level else ''
        module = '.'.join(part for part in [base, n.module or ''] if part) if n.level else n.module or ''
        for alias in n.names:
            if alias.name == '*':
                issue('unresolved', self.file, module + '.*', 'Wildcard imports are not expanded.', n.lineno, self.scope, 'imports')
                continue
            ident = self.add(n, alias.asname or alias.name, 'import')
            imports[ident] = (module, alias.name)
            ast_ids.pop(id(n), None)

for item in data['files']:
    try:
        text = (root / item['relative']).read_text(encoding='utf-8-sig')
        tree = ast.parse(text, filename=item['relative'], type_comments=True)
        trees[item['relative']] = tree
        Collector(item, text).visit(tree)
    except (SyntaxError, UnicodeError, OSError, ValueError) as err:
        issue('parse', item['relative'], 'Python parse issue', str(err)[:500], getattr(err, 'lineno', None))

def lookup(scope, name):
    while scope:
        if name in scopes.get(scope, {}): return scopes[scope][name]
        scope = parent_scopes.get(scope)

def dereference(ident, seen=None):
    seen = set() if seen is None else seen
    if not ident or ident in seen: return None
    seen.add(ident)
    if ident in imports:
        module, name = imports[ident]
        file_id = modules.get(module)
        if name:
            submodule = modules.get(module + '.' + name)
            target = scopes.get(file_id, {}).get(name) if file_id else None
            return dereference(target, seen) if target else submodule
        return file_id
    return ident

def resolve(expr, scope, seen=None):
    seen = set() if seen is None else seen
    if isinstance(expr, ast.Name): return dereference(lookup(scope, expr.id))
    if isinstance(expr, ast.Attribute):
        if isinstance(expr.value, ast.Name) and expr.value.id in ('self', 'cls'):
            base = class_for_scope.get(scope)
        else:
            base = resolve(expr.value, scope, seen)
        if base in assignments and base not in seen:
            seen.add(base)
            value, outer = assignments[base]
            if isinstance(value, ast.Call): base = resolve(value.func, outer, seen)
        return dereference(scopes.get(base, {}).get(expr.attr)) if base else None
    return None

class Connections(ast.NodeVisitor):
    def __init__(self, item): self.file, self.scope, self.file_id = item['relative'], item['id'], item['id']
    def definition(self, n):
        ident = ast_ids.get(id(n))
        if not ident: return
        if isinstance(n, ast.ClassDef):
            for base in n.bases:
                target = resolve(base, self.scope)
                if target: link(ident, target, 'inherits', self.file, base.lineno)
                else: issue('unresolved', self.file, ast.unparse(base), 'Base class cannot be statically resolved.', base.lineno, ident, 'inherits')
        for deco in n.decorator_list: self.visit(deco)
        outer, self.scope = self.scope, ident
        for stmt in n.body: self.visit(stmt)
        self.scope = outer
    visit_FunctionDef = definition
    visit_AsyncFunctionDef = definition
    visit_ClassDef = definition

    def visit_Import(self, n):
        for alias in n.names:
            target = modules.get(alias.name)
            if target: link(self.file_id, target, 'imports', self.file, n.lineno)
            else: issue('external', self.file, alias.name, 'Module is outside the scanned Python project or is unavailable.', n.lineno, self.file_id, 'imports')

    def visit_ImportFrom(self, n):
        for alias in n.names:
            local = lookup(self.scope, alias.asname or alias.name)
            module, _ = imports.get(local, ('', None))
            target = modules.get(module) or modules.get(module + '.' + alias.name)
            if target: link(self.file_id, target, 'imports', self.file, n.lineno)
            else: issue('unresolved' if n.level else 'external', self.file, module, 'Imported module is not in the scanned graph.', n.lineno, self.file_id, 'imports')

    def visit_Call(self, n):
        target = resolve(n.func, self.scope)
        if target: link(self.scope, target, 'calls', self.file, n.lineno)
        else: issue('unresolved', self.file, ast.unparse(n.func)[:180], 'Call target is external or requires runtime information.', n.lineno, self.scope, 'calls')
        self.generic_visit(n)

    def visit_Name(self, n):
        if not isinstance(n.ctx, ast.Load): return
        target = resolve(n, self.scope)
        if target: link(self.scope, target, 'references', self.file, n.lineno)
        else: issue('unresolved', self.file, n.id, 'Reference is external or cannot be statically resolved.', n.lineno, self.scope, 'references')

    def visit_Attribute(self, n):
        if isinstance(n.ctx, ast.Load):
            target = resolve(n, self.scope)
            if target: link(self.scope, target, 'references', self.file, n.lineno)
            else: issue('unresolved', self.file, ast.unparse(n)[:180], 'Attribute requires runtime information or is outside the graph.', n.lineno, self.scope, 'references')
        self.visit(n.value)

for item in data['files']:
    tree = trees.get(item['relative'])
    if tree:
        Connections(item).visit(tree)
        for name, ident in scopes[item['id']].items():
            if not name.startswith('_') and node_by_id.get(ident, {}).get('kind') != 'import':
                node_by_id[ident]['exported'] = True
                link(item['id'], ident, 'exports', item['relative'], node_by_id[ident]['line'])

json.dump(dict(nodes=nodes, edges=edges, issues=issues), sys.stdout, ensure_ascii=True)
