# Sourcefield

Sourcefield is a desktop tool for exploring codebases as interactive 3D maps. It maps folders, files, and individual declarations, then connects them through containment, imports, exports, calls, inheritance, and references.

Use it to understand an unfamiliar project, locate an implementation, follow dependencies, investigate the impact of a change, or share a browsable snapshot of a codebase. Its local MCP server lets compatible AI clients search the same graph, retrieve relevant source sections, and control the visualization.

Analysis runs on your computer. Sourcefield does not execute your project to create a map.

## Contents

- [Open a project](#open-a-project)
- [Read the map](#read-the-map)
- [Navigate and inspect code](#navigate-and-inspect-code)
- [Developer workflows](#developer-workflows)
- [View settings and performance](#view-settings-and-performance)
- [Save, share, and reopen maps](#save-share-and-reopen-maps)
- [Use Sourcefield from a terminal](#use-sourcefield-from-a-terminal)
- [Use Sourcefield with AI](#use-sourcefield-with-ai)
- [Supported languages](#supported-languages)
- [Analysis coverage and limits](#analysis-coverage-and-limits)
- [Data and privacy](#data-and-privacy)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Technical documentation](#technical-documentation)

## Open a project

1. Launch Sourcefield and choose **Open folder**.
2. Select the root directory of the project you want to explore.
3. Wait for Sourcefield to read the files, analyze declarations, trace relationships, and arrange the map. The progress overlay shows the current stage.
4. Search for a familiar file, class, or function to start exploring.

Choose a directory that contains the code you are interested in. For a large monorepo, selecting a package or application directory can give you a more manageable map. Relationships to code outside the scanned directory may remain external or unresolved.

Use **Cancel scan** to stop an analysis. A new map replaces the current map when its scan finishes successfully. Sourcefield displays one active project or saved map at a time.

### Refresh after code changes

A map is a static analysis snapshot. Sourcefield does not watch your source directory or update relationships as you edit files.

To refresh it, use **Open folder** again and select the same project. This creates a new graph from the current source. An exported map always retains the snapshot that was saved into it.

### Runtime requirements

| Feature | Requirement |
| --- | --- |
| Desktop visualization | A working WebGL graphics context |
| Python analysis | Python 3.10 or newer available as `python3` or `python` on PATH |
| Analysis of the other supported languages | No separate language compiler is required |
| Local MCP connection | Node.js 22.12 or newer available to the AI client |

Sourcefield does not install your project's dependencies or run its build scripts. Existing dependency type declarations can help the JavaScript/TypeScript analyzer resolve symbols, but dependency files are not automatically added to the visible graph.

## Read the map

The map places the project's extracted graph into a roughly spherical layout. Amber points represent nodes; connections represent relationships found during analysis. Every point belongs to the analyzed hierarchy or a declaration. There are no filler nodes.

Spatial proximity helps organize the visualization, but it does not by itself establish a dependency. Follow the connections and inspect their relationship types when reasoning about the code. Bright areas reflect node emphasis and overlapping points and connections; they are not runtime profiling, test coverage, or error severity indicators.

### Nodes

Depending on the language and syntax, nodes can represent:

- Folders and files.
- Classes, interfaces, types, enums, and namespaces.
- Functions, methods, and callbacks.
- Variables, parameters, and properties.
- Import bindings and other recognized declarations.

Unsupported files still appear as file nodes in their real folders. Their contents do not contribute a complete symbol graph. Files with recoverable syntax issues can appear with partial analysis.

### Relationships and direction

| Relationship | Direction | Meaning |
| --- | --- | --- |
| `contains` | Parent → child | A folder contains a file, a file contains a declaration, or a declaration contains another declaration. |
| `imports` | Importing file → imported file | A local import or supported include/require relationship was resolved. |
| `exports` | File → exported symbol | A declaration is exposed by a module or is treated as visible by that language's analyzer. |
| `calls` | Caller → callee | A call target could be resolved statically. |
| `inherits` | Derived declaration → base declaration | A supported inheritance or implementation target was resolved. |
| `references` | Referencing declaration → referenced symbol | A use of another symbol was resolved. |

Repeated occurrences between the same source, target, and relationship type are grouped into one edge with an occurrence count. The edge can retain multiple source locations.

The strength of relationship resolution depends on the language. JavaScript and TypeScript use compiler symbol identities; the other analyzers use syntax and conservative lexical or module resolution. See [Supported languages](#supported-languages) before treating the graph as complete.

### Progressive labels

At the widest zoom, labels are hidden so the whole structure remains visible. As you move closer, folder and file labels appear first, followed by individual symbol names.

Labels fade with distance and are checked for overlap. Sourcefield displays up to 90 labels at once, so an unlabeled point is not necessarily missing a name. Search or select the node when you need an exact identity.

## Navigate and inspect code

| Action | Control |
| --- | --- |
| Orbit the map | Left-drag |
| Pan | Right-drag or Shift-drag |
| Move closer or farther away | Scroll, pinch, or use the zoom buttons |
| Fit the whole map | Fit button or `Shift+F` |
| Select and focus a node | Click a point or its visible label |
| Clear the selection | Click empty space or close the inspector |
| Follow a relationship | Click a direct-connection row in the inspector |

Point selection uses the visible screen position and a click target that scales with the rendered point. You can also select a visible label or use search when a region is dense.

### Search for a symbol or file

Use the toolbar search field to find a symbol by name or a file by its relative path. Search is case-insensitive.

For example:

```text
matchesQuery
Notebook
src/notebook.js
```

Search results show the node name, kind, and source path, with a line number when available. Exact and prefix name matches are prioritized. Use the arrow keys to move through results and press `Enter` to focus one, or click a result directly.

The interface shows up to 60 matching results. Narrow a broad query with a more specific name or path. MCP searches support additional filters and pagination.

### The node inspector

Selecting a node highlights its direct connections and opens the inspector. Available details include:

- Node name and declaration kind.
- Source path, language, and line/column location.
- Export status and analysis status where known.
- A type or declaration signature where available.
- A source preview captured at scan time.
- Incoming and outgoing direct connections, occurrence counts, and known locations.

Clicking a connection moves to its neighboring node. This lets you follow a call chain or dependency through the project without repeatedly searching from scratch.

Source previews in the inspector are snapshots, not an editor or a live view of the file. Use the displayed location in your editor when changing code, and rescan after changes to refresh the map.

## Developer workflows

### Understand an unfamiliar codebase

1. Open the project and inspect the folder/file structure.
2. Search for an entry point, a public class, or a file you recognize.
3. Inspect its imports and outgoing calls to identify the next layer of implementation.
4. Follow connection rows into related declarations.
5. Check the analysis report to understand gaps in the map.

Disable relationship layers that are not relevant to the question. For example, turning off references and containment can make a particular call chain easier to inspect.

### Find an implementation

Search for the function, class, or file name. Inspect its path, signature, and source preview, then follow its direct connections.

If you know a string from the implementation but not its symbol name, an AI connected through MCP can use `sourcefield_search_source` for a literal text search and return matching file locations.

### Trace callers and dependencies

For a function, outgoing `calls` edges lead to callees; incoming `calls` edges identify callers. Reference edges cover symbol uses that are not necessarily calls.

For a file, import edges show which local files it imports and which local files import it. Containment edges connect the file to its extracted declarations.

The MCP tools can return callers, callees, and references directly, or follow them over a bounded number of hops. Use incoming call traversal for impact analysis and outgoing call traversal to examine dependencies.

### Review the impact of a change

1. Find the symbol you intend to change.
2. Inspect its incoming calls and references.
3. Check related files and, where relevant, derived classes or interfaces.
4. Read the affected source sections in your editor or through MCP.
5. Check unresolved relationships before concluding that no other code is affected.

A missing edge does not prove that there is no dependency. Runtime dispatch, reflection, generated code, framework conventions, and incomplete type information can prevent static resolution.

### Try the included example

The `example/` directory contains a small JavaScript notebook application called Field Notes. Open that directory in Sourcefield and search for `matchesQuery`.

The callback inside `Notebook.search` in `src/notebook.js` calls `matchesQuery` in `src/search.js`, which calls `normalize`. Follow those connections to explore a real cross-file call chain. You can then export the map and reopen it after moving the example directory.

## View settings and performance

Open **View settings** from the controls at the upper right of the map.

### Dependency code

**Show dependency code** is off by default. Installed libraries are left out of the scan and map so your own code stays easier to navigate. Turn it on in View settings to rescan the current project with recognized dependency folders included. Turning it off rescans with those folders excluded again.

This changes the actual scan scope, including symbol search and MCP results. It is not just a visibility filter over an already loaded library graph. The successful setting is remembered for future folder scans; cancelling or failing a rescan keeps the previous map and preference.

The analysis report lists detected dependency folders that were excluded. Saved maps preserve their scan scope. An imported map can only show code that was exported; open its project folder to change dependency inclusion. Including dependencies can substantially increase scanning time and map size, and the existing scan limits still apply. Project files are enumerated before dependency contents so libraries do not take the file budget ahead of your own source.

### Connection layers

Toggle containment, imports, exports, calls, inheritance, or references to show the relationships relevant to your current investigation. Hiding a layer changes the visualization without removing those relationships from the map.

The separate label control enables or disables progressive labels.

### Glow effects

**Glow effects** enables or disables the graph's glow. The **Strength** slider changes its intensity from `0` to `2.5`. A strength of zero disables glow.

Turning glow off bypasses bloom postprocessing and removes node halos. The map, selection, connections, labels, search, and inspector remain available.

### Automatic performance

With **Automatic performance** enabled, Sourcefield measures frame times while its window is visible and focused. After a warm-up period, sustained rendering below roughly 21 frames per second causes it to pause glow automatically.

The detector ignores background throttling and avoids reacting to a single ordinary stutter. It measures rendering performance rather than GPU temperature or utilization.

When glow is paused, Sourcefield displays a notice. Open View settings and choose **Restore glow** to retry, or adjust the glow settings yourself. It does not continually switch glow back on while the map remains slow. Your manual glow preferences and the automatic-performance preference are saved locally.

For very large projects, opening a smaller package or source subdirectory can reduce the amount of graph data being rendered.

### Window state

Sourcefield remembers its window size, position, maximized state, and fullscreen state between launches. If a monitor is disconnected or its work area changes, the restored bounds are adjusted to keep the window visible.

## Save, share, and reopen maps

Choose **Export** to save the current map through the native save dialog. Sourcefield uses the `.sourcefield` extension.

A map preserves:

- Extracted nodes and their metadata.
- Resolved relationships, occurrence counts, and saved source locations.
- Exact node coordinates and layout metadata.
- Analysis diagnostics and project statistics.
- Limited source previews.
- The camera position and target, selected node, visible relationship layers, and label setting.

### Reopen a snapshot

Use **Open saved map**, pass its path from a terminal, or double-click it in Explorer when the extension is associated with Sourcefield.

Reopening reuses the stored layout. It does not rescan the project or rearrange the nodes. The original source directory can be moved, renamed, or unavailable, and the saved graph remains browsable.

A snapshot is not a complete source-code backup. Saved previews are limited, and an imported map does not automatically reconnect to its original source directory. Open the project folder separately when you want a fresh scan or current source access through MCP.

### Open from Explorer

Sourcefield accepts `.sourcefield` paths directly, including filenames with spaces and extensions written in uppercase. If the app is already running, it restores/focuses the existing window and opens the map there. A map opened this way while a scan is running cancels the scan first.

File association is configured by your installer or operating system. The recommended open command is:

```bat
"C:\Program Files\Sourcefield\Sourcefield.exe" --map "%1"
```

Use the actual executable path for your installation. Details for Inno integration are in [File association](docs/file-association.md).

### Share a map

Send the `.sourcefield` file to someone who can open it in Sourcefield. They can inspect its graph and use MCP against the saved metadata and previews without receiving the original project directory.

Exported maps contain source excerpts, paths, and declaration names. Treat them as source-containing artifacts when deciding who can access them.

The versioned file format, encoding, and validation rules are documented in [Map format](docs/format.md).

## Use Sourcefield from a terminal

When the `sourcefield` command is available on PATH, open the current directory with:

```sh
sourcefield .
```

Other supported forms are:

```sh
sourcefield
sourcefield ../another-project
sourcefield "/path/to/my project"
sourcefield ./project-snapshot.sourcefield
sourcefield --help
sourcefield --version
```

| Command | Behavior |
| --- | --- |
| `sourcefield` | Opens the desktop app. |
| `sourcefield .` | Opens and scans the terminal's current directory. |
| `sourcefield <directory>` | Opens and scans an absolute or relative project directory. |
| `sourcefield <map.sourcefield>` | Opens a saved snapshot. |
| `sourcefield mcp` | Runs the local MCP stdio server through the Node CLI launcher. |

Quote paths containing spaces. The desktop executable also accepts directory arguments and the explicit `--map <path>` option. Availability of the command on PATH depends on how Sourcefield was distributed or registered on the machine.

The MCP entry waits for protocol requests; it is not an interactive terminal prompt.

## Use Sourcefield with AI

Sourcefield includes an MCP server for compatible desktop AI clients, including Claude Desktop and ChatGPT desktop/Codex clients with local MCP support. The same server implementation provides the same tools to either client; their configuration formats differ.

It lets a model find relevant symbols, follow actual graph relationships, and request specific source ranges instead of automatically loading a whole codebase into the conversation. Token savings depend on the task and on how much source the model ultimately needs to read.

### Connect a client

1. Open a project folder or saved map in Sourcefield and keep its window open.
2. Click the plug button at the bottom right.
3. Select **Claude Desktop** or **ChatGPT / Codex**.
4. Copy the displayed configuration into that client's local MCP settings.
5. Restart the client as needed, enable the Sourcefield tools, and ask a question about the active project.

The dialog supplies the correct server path for the current installation. The client launches it with Node.js. If the client cannot find `node`, use the absolute path to the Node executable.

Sourcefield does not modify the client's configuration for you. Full configuration examples, client-specific instructions, and packaged-app paths are in [Local MCP integration](docs/mcp.md).

### Available MCP tools

| Tool | Use |
| --- | --- |
| `sourcefield_project_overview` | Get the active project ID, source mode, languages, counts, diagnostic totals, and important files. |
| `sourcefield_search_symbols` | Search names and paths with kind, language, export, and path filters. Returns IDs, locations, signatures, previews, and connection counts. |
| `sourcefield_get_symbol` | Inspect one declaration, its containment chain, saved preview, connection counts, and related diagnostics. |
| `sourcefield_get_connections` | Retrieve incoming or outgoing calls, references, imports, exports, inheritance, or containment, with linked symbol metadata and known source locations. |
| `sourcefield_trace_dependencies` | Follow selected directed relationships across a bounded number of hops. |
| `sourcefield_read_source` | Read numbered source lines for a symbol or relative file path, or retrieve a saved preview from an offline map. |
| `sourcefield_search_source` | Search literal text in a bounded set of scanned files or saved previews, with coverage and truncation information. |
| `sourcefield_get_diagnostics` | Inspect unsupported files, syntax issues, skipped files, limits, and unresolved or external targets. |
| `sourcefield_get_view` | Read the camera, selection, highlighted node IDs, and visible layers. |
| `sourcefield_control_view` | Focus, select, highlight, fit, zoom, clear selection, or change layers and labels in the desktop window. |

### A useful request sequence

Start with `sourcefield_project_overview`, then search. Keep the returned `project_id` and use exact `node_id` values from the results.

For example, search for a function:

```json
{
  "query": "matchesQuery",
  "kinds": ["function"],
  "limit": 10
}
```

Pass those arguments to `sourcefield_search_symbols`. Then use the returned IDs to retrieve its callers:

```json
{
  "project_id": "<project_id from the response>",
  "node_id": "<node_id from the search result>",
  "kinds": ["calls"],
  "direction": "incoming",
  "limit": 15
}
```

Pass the second object to `sourcefield_get_connections`. Read the relevant source with `sourcefield_read_source`, or focus the symbol using `sourcefield_control_view`:

```json
{
  "action": "focus",
  "project_id": "<project_id from the response>",
  "node_id": "<node_id from the search result>"
}
```

Example questions for an AI client include:

- “Find `matchesQuery`, show its callers, and focus it in Sourcefield.”
- “Trace the outgoing calls from this function for two hops.”
- “Find where this class is referenced and return the file locations.”
- “Search the source for this error message and read the surrounding implementation.”
- “Explain this module using its imports and declarations, and highlight the relevant nodes.”

The model receives requested tool results. Sourcefield does not automatically insert the complete graph or every source file into its context.

### Live source, snapshots, and shared state

| Situation | Graph and metadata | Source retrieval |
| --- | --- | --- |
| A project folder is open | Reflects the most recent scan. | MCP can read current contents of scanned files inside that project. |
| A saved map is open | Uses the exported graph and exact stored coordinates. | MCP uses saved declaration previews and reports incomplete coverage. |
| Source changed after scanning | Graph relationships and locations may be stale. | Current file reads flag modification times newer than the graph; rescan to refresh analysis. |

The inspector and `get_symbol` previews always show scan-time excerpts. They are distinct from a current-file read through `read_source`.

Opening or rescanning a project creates a new `project_id`. Requests carrying an old ID fail instead of silently switching context. Search again and use the new ID. Multiple clients can connect simultaneously, but they share the same active project and visible map.

The MCP tools can read scoped project data and change the view. They do not edit source, run shell commands, execute the project, or open arbitrary filesystem paths.

## Supported languages

| Language | Common extensions | Analysis approach |
| --- | --- | --- |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | TypeScript compiler API with JavaScript analysis. |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` | TypeScript compiler API, including root `tsconfig.json`/`jsconfig.json` path-alias handling where applicable. |
| Python | `.py`, `.pyi` | Python standard-library AST with lexical declarations and local import resolution. |
| Go | `.go` | Tree-sitter syntax analysis with package scope and local module paths from `go.mod`. |
| Rust | `.rs` | Tree-sitter syntax analysis with declarations, explicit local use paths, and conservative reference/call resolution. |
| Java | `.java` | Tree-sitter syntax analysis for supported classes, interfaces, methods, declarations, imports, and relationships. |
| C | `.c`, `.h` | Tree-sitter syntax analysis for declarations, types, functions/prototypes, local includes, and supported relationships. |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` | Tree-sitter syntax analysis for supported declarations, includes, calls, and references. `.h` files can use the C++ parser when C++ files are detected. |
| C# | `.cs` | Tree-sitter syntax analysis for supported namespaces, types, methods, fields, parameters, and relationships. |
| PHP | `.php` | Tree-sitter syntax analysis for supported namespaces, classes, functions, variables, imports, and relationships. |
| Ruby | `.rb`, `.rake` | Tree-sitter syntax analysis for supported classes, methods, variables, explicit local requires, and relationships. |

Supported language does not mean every declaration form or runtime relationship can be resolved. Some constructs are extracted only partially, and others remain unresolved.

JavaScript/TypeScript have compiler-backed symbol resolution. The other analyzers use conservative lexical or module rules rather than a full compiler or language server. Python analysis requires a system Python interpreter; the other parsers are included with the application.

Dynamic dispatch, reflection, macros, generated code, overloaded or ambiguous targets, complex destructuring, wildcard imports, C/C++ build flags, Rust impl/trait dispatch, and framework autoloading can leave gaps. Export relationships also vary by language: compiler exports for JS/TS, public module names for Python, and visible declarations for syntax-based analyzers.

## Analysis coverage and limits

Open the analysis report from the bottom status bar to inspect coverage.

| Diagnostic | Meaning |
| --- | --- |
| `unsupported` | The file appears in the hierarchy, but its language is not analyzed. |
| `unresolved` | A relationship target could not be established statically. |
| `external` | The target is outside the scanned graph, such as a dependency or platform API. |
| `parse` | Syntax could not be fully parsed; recovered declarations may still be shown. |
| `skipped` | A file or directory could not be analyzed because of size, access, or an unavailable parser/runtime. |
| `limit` | A scan or analysis limit was reached. |

Use the report's filters to inspect the relevant category. When a diagnostic has a known source node, its action can take you to that node.

### Files included in a scan

The scanner applies nested `.gitignore` rules and skips symlinks. It detects common installed-library directories and prunes them before enumerating their contents when **Show dependency code** is off.

| Ecosystem | Recognized dependency folders or markers |
| --- | --- |
| JavaScript / TypeScript | `node_modules`, `bower_components`, `jspm_packages`, `.yarn`, `.pnpm-store`, `.npm` |
| Python | `.venv`, `venv`, `site-packages`, `dist-packages`, `__pypackages__`; custom-named environments with `pyvenv.cfg` or `conda-meta/history` |
| PHP, Go, Ruby, Rust | `vendor` next to an ecosystem manifest, or with Go/Composer installation markers; Cargo's `.cargo/registry` and `.cargo/git`; Go's `pkg/mod` with a download-cache marker |
| Java / Kotlin | `.m2`, `.gradle` |
| .NET | `.nuget`; installed NuGet package directories identified by `.nupkg.metadata` or a matching `.nupkg` file |
| C / C++ | `vcpkg_installed`, `.conan`, `.conan2`, `third_party`, `third-party`, `thirdparty`; CMake `_deps` beside `CMakeCache.txt` |
| Apple platforms | `Pods` with a Podfile or installation marker; `Carthage` next to a Cartfile |
| Other ecosystems | `.pub-cache`, Lua's `lua_modules`, OCaml's `_opam`, Elixir's `deps` next to `mix.exs` |

Folder detection works independently of symbol-analysis support: a recognized Dart dependency directory can be excluded even though Dart symbols are not currently analyzed. Ordinary `lib`, `libs` and monorepo `packages` directories are kept unless another ignore rule applies. `.NET` `bin` and `obj` are treated as generated output only beside a project file.

Explicit dependency opt-in overrides inherited `.gitignore` rules at a recognized dependency root. That root's own ignore files still apply. Other ignored source folders remain excluded. Build output, caches and metadata such as `dist`, `build`, `target`, `.next`, `coverage`, `__pycache__`, `.git` and `.sourcefield` stay excluded in both modes.

`.env` files, common private-key file extensions, and Sourcefield's `.sourcefield` runtime directory are excluded. Hard exclusions still apply even when a directory would otherwise be included by ignore rules.

The ignored count measures skipped directory entries, not the number of files recursively contained in those directories. An unsupported file and an ignored file are different: unsupported files can appear as nodes, while ignored entries are left out of the graph.

### Practical limits

| Area | Current limit |
| --- | --- |
| Files enumerated in a project scan | 12,000 |
| Per-file content analysis | 2 MiB |
| Symbol extraction budget | 100,000 per analyzer |
| Saved declaration preview | Up to 12 lines and 2,400 characters |
| Visible graph labels | Up to 90 at once |
| Map file size and expanded JSON | 256 MiB each |
| Default MCP result page | 15 results; paginated tools allow up to 60 |
| MCP source read | 80 lines by default; up to 250 per request |
| MCP dependency traversal | Up to 4 hops and 100 nodes; additional edge/result limits apply |
| MCP literal text search | Up to 300 candidate files and 40 returned matches per request |

MCP source reads have a 2 MiB file limit. Responses include pagination, truncation, or coverage information where relevant. A partial search or traversal should not be interpreted as a complete inventory of all dependencies or matches.

Large projects may need to be explored package by package. File size, export size, and analysis limits are not configurable in the current interface.

## Data and privacy

Code analysis, layout generation, rendering, map export, and the MCP bridge run locally. Sourcefield does not run project scripts or upload a codebase to a service to generate its map.

The MCP server uses stdio between the AI client and server process, plus a credentialed private local bridge to the desktop app. No public endpoint or listening network port is required. Reads are restricted to scanned files inside the active source root, with canonical path checks. Reopened maps expose their saved metadata and previews without requiring the original folder.

An AI provider can still receive the source sections and tool results its client sends to the model. A local MCP connection does not make a cloud-hosted model run offline.

Sourcefield stores window state and rendering preferences locally. Exported maps store the graph, view state, diagnostics, and source excerpts described above.

## Keyboard shortcuts

Use `Ctrl` on Windows/Linux and `Command` on macOS for the primary modifier.

| Shortcut | Action |
| --- | --- |
| `Ctrl/Command+O` | Open a project folder. |
| `Ctrl/Command+Shift+O` | Open a saved map. |
| `Ctrl/Command+F` | Focus symbol/file search. |
| `/` | Focus search when not typing in a text field. |
| `Ctrl/Command+E` | Export the active map. |
| `Shift+F` | Fit the map. |
| `Arrow Up` / `Arrow Down` in search | Move through search results. |
| `Enter` in search | Focus the selected result. |
| `Escape` | Dismiss open menus, search results, or dialogs. |

Native menus also expose file actions, standard editing commands, and fullscreen control.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| A file or folder is missing | Check `.gitignore`, hard exclusions, symlinks, access permissions, and the scan's file limit. |
| A file appears but has no declarations | Check its language, analysis status, and the report for unsupported, skipped, or syntax diagnostics. |
| Python symbols are missing | Make sure Python 3.10+ is available as `python3` or `python` on PATH, then rescan. |
| A known call or reference is absent | Inspect unresolved/external diagnostics and language limitations. Rescan if the source changed. |
| Labels are not visible | Enable labels and zoom closer. Overlap prevention can hide some names; use search for an exact symbol. |
| Nodes are hard to pick in a dense area | Zoom closer, click a visible label, or select the node from search. |
| The map is slow | Turn off Show dependency code, reduce or disable glow, enable Automatic performance, or scan a smaller directory. |
| Glow switched off by itself | Automatic performance paused it. Use View settings → Restore glow to retry. |
| A source preview looks outdated | Inspector previews are scan-time snapshots. Rescan the project; MCP can also read current scanned source files. |
| A map opens without its source folder, but full source is unavailable | Expected for a saved map. It retains graph data and limited previews, not complete source files. |
| Explorer does not open the map in Sourcefield | Check the file association and ensure the executable path and `%1` are quoted. |
| An AI client lists tools but calls fail | Keep Sourcefield open with a project/map loaded and wait for a scan to finish. |
| The client cannot start the MCP server | Check the Node executable, absolute server path, client configuration, and client logs. |
| An MCP request reports a different project | Get a fresh overview or search result and use its new `project_id`. |
| The 3D view cannot start | Check that the system can create a working WebGL graphics context. |

Client-specific MCP troubleshooting is in [Local MCP integration](docs/mcp.md).

## Technical documentation

| Document | Covers |
| --- | --- |
| [Local MCP integration](docs/mcp.md) | Claude and ChatGPT/Codex configuration, tool behavior, installed-app paths, and integration checks. |
| [Map format](docs/format.md) | Binary header, compression, versioned schema, nodes, edges, view state, and validation. |
| [File association](docs/file-association.md) | Explorer arguments, existing-instance behavior, and Inno open-command integration. |
| [Source development](docs/development.md) | Runtime dependencies, source commands, packaging, project organization, and icon assets. |

## License

Sourcefield is distributed under the [MIT license](LICENSE). Third-party dependencies retain their own licenses.
