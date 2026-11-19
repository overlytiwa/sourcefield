// Focused regression check for scan scope, opt-in and portable snapshots.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const apiFile = path.resolve('dist-electron/dependencies-smoke-api.cjs');
await build({ stdin: { contents: "export { scanProject } from './electron/analyzer/scan'; export { encodeMap, decodeMap, validateMap } from './electron/format';", resolveDir: process.cwd() },
  outfile: apiFile, bundle: true, platform: 'node', format: 'cjs', external: ['typescript', 'web-tree-sitter'] });
const { scanProject, encodeMap, decodeMap, validateMap } = createRequire(import.meta.url)(apiFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sourcefield-dependencies-'));
const put = async (p, content = 'fixture') => { await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true }); await fs.writeFile(path.join(root, p), content); };
try {
  await put('package.json', '{}'); await put('composer.json', '{}'); await put('mix.exs'); await put('Podfile');
  await put('.gitignore', 'node_modules/\n.venv/\ncustom-python/\n/vendor/\nignored-source/\n');
  await put('src/main.ts', "import { libraryCall } from '../node_modules/library/index'; export function app() { return libraryCall(); }");
  await put('node_modules/library/index.ts', 'export function libraryCall() { return 42; }');
  const libraries = ['.venv', 'custom-python', 'vendor', 'bower_components', 'Pods', 'deps', 'vcpkg_installed', 'third_party', '.nuget/packages', '.cargo/registry', 'pkg/mod'];
  for (const folder of libraries) await put(`${folder}/library.txt`);
  await put('custom-python/pyvenv.cfg', 'home = /python'); await put('pkg/mod/cache/download/marker');
  const own = ['lib', 'libs', 'packages/app', 'bin', 'src/vendor'];
  for (const folder of own) await put(`${folder}/owned.txt`);
  await put('dotnet/app.csproj', '<Project/>'); await put('dotnet/bin/output.txt'); await put('dotnet/obj/cache.txt');
  await put('dist/output.js'); await put('.git/config'); await put('.sourcefield/session.json'); await put('.env'); await put('private.key'); await put('ignored-source/private.ts');
  await put('node_modules/library/dist/build.ts'); await put('node_modules/library/.env');
  await fs.symlink(path.join(root, 'src'), path.join(root, 'linked-src'), 'dir');
  const originalReadDir = fs.readdir;
  let dependencyReads = 0;
  fs.readdir = async function (dir, ...args) { if (String(dir).startsWith(path.join(root, 'node_modules'))) dependencyReads++; return originalReadDir.call(this, dir, ...args); };
  let normal;
  try { normal = await scanProject(root, () => {}); } finally { fs.readdir = originalReadDir; }
  assert.equal(dependencyReads, 0, 'Default scan prunes node_modules before enumeration');
  assert(normal.scan.excludedDependencyCount >= libraries.length + 1);
  for (const folder of ['node_modules', ...libraries]) assert(!normal.nodes.some(n => n.path === folder || n.path.startsWith(folder + '/')), folder + ' is excluded');
  for (const folder of own) assert(normal.nodes.some(n => n.path === folder + '/owned.txt'), folder + ' remains project code');
  const included = await scanProject(root, () => {}, { includeDependencies: true });
  for (const folder of ['node_modules', ...libraries]) assert(included.nodes.some(n => n.path === folder), folder + ' is included on request');
  assert.equal(included.scan.excludedDependencyCount, 0);
  const target = included.nodes.find(n => n.name === 'libraryCall' && n.kind === 'function');
  assert(target && included.edges.some(e => e.kind === 'calls' && e.target === target.id && included.nodes.find(n => n.id === e.source)?.path === 'src/main.ts'), 'An included library function has a real cross-file call');
  for (const hidden of ['dist', '.git', '.sourcefield', '.env', 'private.key', 'ignored-source', 'linked-src', 'dotnet/bin', 'dotnet/obj', 'node_modules/library/dist', 'node_modules/library/.env']) assert(!included.nodes.some(n => n.path === hidden || n.path.startsWith(hidden + '/')), hidden + ' stays excluded');
  assert.deepEqual(decodeMap(encodeMap(normal)).scan, normal.scan);
  assert.deepEqual(decodeMap(encodeMap(included)).nodes, JSON.parse(JSON.stringify(included.nodes)));
  const legacy = { ...normal }; delete legacy.scan; assert(validateMap(legacy), 'Older maps still open');
  assert.throws(() => validateMap({ ...normal, scan: { ...normal.scan, includeDependencies: 'yes' } }));
  console.log(`Dependency smoke passed: ${normal.scan.excludedDependencyCount} dependency roots pruned; own code retained; opt-in, cross-file call, secret/build exclusions and map round-trip verified.`);
} finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(apiFile, { force: true }); }
