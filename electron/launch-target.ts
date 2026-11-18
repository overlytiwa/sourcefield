import path from 'node:path';

/** Accept direct Explorer/Open With arguments as well as explicit CLI flags. */
export function launchTarget(argv: string[], cwd: string, packaged: boolean): { file?: string; project?: string } {
  const mapAt = argv.indexOf('--map'), projectAt = argv.indexOf('--project');
  if (mapAt >= 0 && argv[mapAt + 1]) return { file: path.resolve(cwd, argv[mapAt + 1]) };
  if (projectAt >= 0 && argv[projectAt + 1]) return { project: path.resolve(cwd, argv[projectAt + 1]) };
  const args = argv.slice(packaged ? 1 : 2);
  const file = args.find(a => a.toLowerCase().endsWith('.sourcefield'));
  if (file) return { file: path.resolve(cwd, file) };
  const directory = args.find(a => !a.startsWith('-'));
  return directory ? { project: path.resolve(cwd, directory) } : {};
}
