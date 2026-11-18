# Developing Sourcefield

This guide covers working on the application source. For using Sourcefield to
explore a project, see the [README](../README.md).

## Requirements

- Node.js 22.12 or newer and npm.
- Python 3.10+ on PATH to analyze Python projects.
- A desktop graphics environment capable of creating a WebGL context.

Other supported language analyzers use the included TypeScript compiler API or
WebAssembly parsers; their language compilers are not required for analysis.

## Source commands

```sh
npm ci
npm run build
npm start
```

`build` generates native icons, checks TypeScript, builds the renderer, and
bundles the Electron main/preload/worker processes and the standalone MCP entry.
The output directories are `dist/` and `dist-electron/`.

For renderer development with hot reload:

```sh
npm run dev
```

This also builds the Electron code before launching it. After changing the main
process, preload, analyzers, or MCP implementation, restart the development
command to rebuild those components.

If dependency install scripts were disabled and the Electron binary is missing,
run `node node_modules/electron/install.js` once.

## Register the source CLI

```sh
npm run install-cli
```

This runs `npm link`, registering the Node launcher as `sourcefield`. The npm
global bin directory must be on PATH. Keep the source directory in place after
linking: the command launches that directory's built application. Windows npm
creates a command shim.

Use `sourcefield .` for a project, `sourcefield snapshot.sourcefield` for a map,
and `sourcefield mcp` for the stdio server. Remove the registration with
`npm unlink -g sourcefield`.

## Checks

| Command | Purpose |
| --- | --- |
| `npm run check` | TypeScript checking. |
| `npm run smoke` | Analyze the Field Notes example, check a cross-file call, export, move the source, reopen, and compare saved graph/view data. |
| `npm run smoke:mcp` | Check the local stdio protocol, tools, source boundaries, view acknowledgement with a renderer stub, offline maps, and Explorer arguments. |

The MCP smoke check uses SDK clients and does not automate Claude or ChatGPT.
Native UI behavior should also be checked on the target desktop platform.

## Desktop packaging

```sh
npm run dist
```

Electron Builder writes packages to `release/`. Targets configured in
`package.json` are NSIS and portable EXE on Windows, DMG on macOS, and AppImage on
Linux. For a Windows build on a suitable host:

```sh
npm run dist -- --win
```

Platform signing credentials are not included. A custom Inno installer should
include the whole unpacked application, including its resources. See
[file association](file-association.md) and the installed-package section of
[the MCP guide](mcp.md).

The standalone MCP bundle is built at `dist-electron/mcp.cjs` and copied into
packaged application resources as `mcp/sourcefield-mcp.cjs`. It includes its
JavaScript dependencies, but the configured client still needs a Node runtime.

## Source organization

| Location | Responsibility |
| --- | --- |
| `electron/main.ts` | Native window, menus, file dialogs, project lifecycle, and trusted renderer IPC. |
| `electron/launch-target.ts` | Directory/map arguments from terminal and OS file-open actions. |
| `electron/window-state.ts` | Persisted window geometry and state. |
| `electron/preload.ts` | Narrow renderer API. |
| `electron/worker.ts` | Background analysis entry point. |
| `electron/analyzer/` | File enumeration, language analyzers, graph extraction, and deterministic layout. |
| `electron/format.ts` | Snapshot encoding, validation, and atomic writes. |
| `electron/mcp/` | Tool schemas, scoped graph/source queries, local bridge, and stdio server. |
| `shared/types.ts` | Graph, view, and bridge contracts. |
| `src/App.tsx` | Toolbar, search, inspector, reports, and controls. |
| `src/graph.ts` | Rendering, camera, selection, label projection, and view commands. |
| `src/picking.ts` | Screen-space point picking. |
| `src/render-settings.ts` | Rendering preferences and sustained low-performance detection. |
| `src/components/` | Shared app icon and MCP configuration interface. |
| `scripts/` | Build, CLI, icon, and smoke-check commands. |
| `resources/` | Vector icon masters and platform icon formats. |
| `example/` | Runnable Field Notes example project. |

## Icon assets

`resources/icon.svg` is the editable master used by the toolbar and app icon.
`resources/icon-small.svg` is a compatible copy. The earlier detailed artwork
is retained separately as `resources/icon-detailed.svg` and is not the app icon.

```sh
npm run icons
```

This renders the master to PNG sizes, a multi-image Windows ICO, and a macOS
ICNS. Icon generation also runs during the production build. The generated
native assets are included so development launches can use them immediately.

`node scripts/draw-icon.mjs` regenerates the vector masters from their
construction code. Running it overwrites manual edits to those SVG files.

## Implementation boundaries

Keep analysis separate from rendering. Project code is read as syntax and is
not executed. The renderer has no Node integration; native operations use the
restricted preload API. Snapshot reads validate the format before loading it.

MCP tools operate on the active project's graph and scanned file inventory.
Maintain source-root checks, request bounds, project IDs, and view-command
acknowledgements when extending those tools. The stdio server must reserve
stdout for protocol messages; diagnostic logging belongs on stderr.
