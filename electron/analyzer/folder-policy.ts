import { promises as fs } from 'node:fs';
import path from 'node:path';

// These never become source nodes, even when dependency code is requested.
export const excludedFolders = new Set([
  '.sourcefield', '.git', '.hg', '.svn', '.idea', '.vscode',
  'dist', 'build', 'out', 'release', 'dist-electron', 'coverage', 'target',
  '.next', '.nuxt', '.output', '.svelte-kit', '.angular', '.turbo', '.parcel-cache',
  '.cache', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.nox',
  '.dart_tool', '.build', '.swiftpm', '_build', 'CMakeFiles'
]);

const dependencyFolders = new Map([
  ['node_modules', 'Node.js packages'], ['bower_components', 'Bower packages'],
  ['jspm_packages', 'JSPM packages'], ['.yarn', 'Yarn packages and cache'],
  ['.pnpm-store', 'pnpm package store'], ['.npm', 'npm cache'],
  ['.venv', 'Python virtual environment'], ['venv', 'Python virtual environment'],
  ['site-packages', 'Python installed packages'], ['dist-packages', 'Python installed packages'],
  ['__pypackages__', 'Python local packages'], ['.pub-cache', 'Dart package cache'],
  ['.m2', 'Maven local repository'], ['.gradle', 'Gradle cache'],
  ['.nuget', 'NuGet packages and cache'], ['vcpkg_installed', 'vcpkg packages'],
  ['.conan', 'Conan packages'], ['.conan2', 'Conan packages'],
  ['third_party', 'Third-party code'], ['third-party', 'Third-party code'],
  ['thirdparty', 'Third-party code'], ['lua_modules', 'Lua packages'], ['_opam', 'OCaml packages']
]);
async function exists(file: string) {
  try { await fs.access(file); return true; } catch { return false; }
}

/** Recognize installed code without treating monorepo packages/, lib/ or bin/ as libraries. */
export async function dependencyReason(full: string, siblings: Set<string>): Promise<string | undefined> {
  const name = path.basename(full), parent = path.basename(path.dirname(full));
  const conventional = dependencyFolders.get(name);
  if (conventional) return conventional;
  if (name === 'vendor' && ['composer.json', 'composer.lock', 'go.mod', 'go.work', 'Gemfile', 'Gemfile.lock', 'Cargo.toml'].some(p => siblings.has(p))) return 'Vendored dependencies';
  if (name === 'vendor' && (await exists(path.join(full, 'modules.txt')) || await exists(path.join(full, 'composer', 'installed.json')))) return 'Vendored dependencies';
  if (name === 'Pods' && (siblings.has('Podfile') || await exists(path.join(full, 'Manifest.lock')))) return 'CocoaPods packages';
  if (name === 'Carthage' && (siblings.has('Cartfile') || siblings.has('Cartfile.resolved'))) return 'Carthage packages';
  if (name === 'deps' && siblings.has('mix.exs')) return 'Elixir packages';
  if (name === '_deps' && siblings.has('CMakeCache.txt')) return 'CMake downloaded dependencies';
  if (parent === '.cargo' && (name === 'registry' || name === 'git')) return 'Cargo package cache';
  if (name === 'mod' && parent === 'pkg' && await exists(path.join(full, 'cache', 'download'))) return 'Go module cache';
  // Markers recognize custom-named environments; no recursive probe is needed.
  if (await exists(path.join(full, 'pyvenv.cfg')) || await exists(path.join(full, 'conda-meta', 'history'))) return 'Python environment';
  if (await exists(path.join(full, '.nupkg.metadata'))) return 'Installed NuGet package';
  // Classic NuGet packages have <name.version>/<name.version>.nupkg.
  if (await exists(path.join(full, `${name}.nupkg`))) return 'Installed NuGet package';
  return undefined;
}

export function generatedFolder(name: string, siblings: Set<string>) {
  return excludedFolders.has(name) || (name === 'bin' || name === 'obj') && [...siblings].some(p => /\.(?:cs|fs|vb)proj$/i.test(p));
}
