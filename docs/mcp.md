# Sourcefield MCP: local desktop integration

The same MCP server works with Claude Desktop and ChatGPT desktop/Codex clients
that support local MCP. The server code and tools are identical; only the
client's configuration format differs. GPT and Claude are the models; their
desktop clients start the MCP process and make tool calls on their behalf.

No website, cloud deployment, public URL, plugin, or listening network port is
required. Sourcefield uses standard MCP over stdin/stdout. Each client launches
its own small process; those processes query the same project open in the
Sourcefield desktop window. The app and server communicate through private,
short-lived local files, using a random session credential.

## Build and start

From this source directory:

```sh
npm ci
npm run build
npm start
```

Open a project folder or `.sourcefield` map in Sourcefield. Keep Sourcefield
running. Click the plug icon at the bottom right to see connection settings with
the correct path for your installation. Copy the configuration for your client.
This does not change another application's configuration automatically.

Node.js 22.12+ must be available to the client. On desktop systems where `node`
is not on the GUI application's PATH, replace `node` with its absolute path.
You can find that path with `where node` on Windows or `command -v node` on
macOS/Linux.

## Claude Desktop

Open Claude Desktop's developer configuration and merge in this server entry:

```json
{
  "mcpServers": {
    "sourcefield": {
      "command": "node",
      "args": ["C:\\path\\to\\Sourcefield\\dist-electron\\mcp.cjs"]
    }
  }
}
```

Use the actual absolute path shown inside Sourcefield. On macOS/Linux, the path
looks like `/absolute/path/to/Sourcefield/dist-electron/mcp.cjs`. Preserve any
other entries in `mcpServers`. Restart Claude Desktop and enable Sourcefield's
tools in the conversation.

The configuration file is normally:

| Platform | File |
| --- | --- |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

See the [official local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## ChatGPT desktop / Codex

In a desktop client with local MCP support, open Settings → MCP servers → Add
server. Choose STDIO, set the command to `node`, and put the absolute path to
`mcp.cjs` in the argument list. Save and restart the client.

Alternatively, merge this into `~/.codex/config.toml` (using your real path):

```toml
[mcp_servers.sourcefield]
command = "node"
args = ["C:\\path\\to\\Sourcefield\\dist-electron\\mcp.cjs"]
```

Or register it through the Codex CLI:

```sh
codex mcp add sourcefield -- node "/absolute/path/to/Sourcefield/dist-electron/mcp.cjs"
```

The ChatGPT desktop app and local Codex clients share this configuration on the
same Codex host. This is a local desktop integration; a browser conversation
does not pick up a local configuration file. See the
[official OpenAI documentation](https://learn.chatgpt.com/docs/extend/mcp).

## Terminal shortcut

After `npm run install-cli`, the same server can also be launched as:

```sh
sourcefield mcp
```

For client configuration, using `node` plus the absolute built entry path is
more reliable across Windows command shims and GUI PATH differences. Do not use
`npm run mcp` as the client's command: npm prints banners to stdout, which is
reserved for MCP JSON-RPC. Running the raw server in a terminal waits for MCP
requests; it is not an interactive command prompt.

## Installed desktop packages / Inno

Electron Builder copies a standalone, bundled server to:

```text
<application resources>/mcp/sourcefield-mcp.cjs
```

It does not need a separate `node_modules` folder. It still needs a Node runtime.
When wrapping the unpacked Windows application with Inno, include the entire
application directory, including `resources/mcp/` and the other Electron
resources. The in-app connection dialog automatically shows the installed
server's path; use that path in either client's configuration.

## Tools and useful results

| Tool | What the model receives |
| --- | --- |
| `sourcefield_project_overview` | Project ID, source root/mode, languages, node and edge counts, important files, diagnostic totals |
| `sourcefield_search_symbols` | Ranked names, kinds, IDs, paths, lines, signatures, parent names, previews and connection counts |
| `sourcefield_get_symbol` | Definition metadata, containment chain, saved source preview, incoming/outgoing counts and diagnostics |
| `sourcefield_get_connections` | Actual callers, callees, imports, exports, inheritance or references; linked symbols and source locations |
| `sourcefield_trace_dependencies` | Bounded multi-hop dependency/impact graph with actual directed edges and capped-result notices |
| `sourcefield_read_source` | Numbered source lines for one symbol or relative file path; freshness and snapshot indicators |
| `sourcefield_search_source` | Literal text matches with path, line and short text; file coverage, skipped files and incomplete-search notices |
| `sourcefield_get_diagnostics` | Unresolved/external targets, unsupported/skipped files, syntax issues and scan limits |
| `sourcefield_get_view` | Current camera, selection, highlighted nodes and visible relationship layers |
| `sourcefield_control_view` | Acknowledged focus, select, highlight, fit, zoom, clear, layer or label change in the desktop window |

Results are bounded JSON, not the entire graph or entire codebase. Search and
relationship results use pagination. Normal requests return 15 results; code
reads default to at most 80 lines. There are hard limits on results, file bytes,
traversal size, IPC messages, and response size. Search previews are scan-time
snapshots; `read_source` can retrieve current file contents when available.

Suggested model workflow:

1. Call `sourcefield_project_overview` and keep the returned `project_id`.
2. Search for a name, class or path. Use the exact `node_id` from the response.
3. Inspect incoming calls for callers, outgoing calls for callees, or references
   for usages. Containment can be requested explicitly to list file members.
4. Read only the relevant symbol or line range. Inspect diagnostics before
   assuming every dependency is resolved.
5. Focus or highlight the relevant nodes so the user can follow the explanation.

Example focus arguments after a search:

```json
{
  "action": "focus",
  "node_id": "<exact node_id from search>",
  "project_id": "<project_id from search or overview>"
}
```

Zoom `factor` is a camera-distance multiplier: `0.8` moves closer; `1.25` moves
farther away. Highlight uses `node_ids`. Layer changes use `edge_kinds` and/or
`labels`. Focus/select and highlight also update the actual desktop selection
and graph emphasis. Every view command waits for acknowledgement from the
renderer; a closed or unresponsive window produces an error.

## Project changes, snapshots and scope

Opening another project or map creates a new `project_id`. Requests with a stale
ID fail clearly instead of silently targeting the new project. Multiple clients
can connect simultaneously, but they share one visible project and view.

The graph is a static analysis snapshot. Source files are not edited by these
tools, and the server does not silently rescan them. If files change, code reads
flag source newer than the graph; rescan in Sourcefield to refresh relationships
and source locations.

A reopened map works without the original folder. Search, graph traversal and
view control still work. Source reads use the saved declaration excerpt and
explicitly report incomplete coverage. Offline text search searches saved
previews only. It does not imply the full original source has been searched.

File reads are restricted to the scanned file inventory inside the active
project, with canonical path checks. A symlink changed to point outside the
project is rejected. Ignored files are not made available. Binary and oversized
files are excluded from text reads. Sourcefield's private MCP runtime folder is
also excluded from scans. There are no shell, arbitrary file access, editing,
installation, or network tools. The server requires the local session credential
and never includes that credential in model results.

Sourcefield and its bridge stay on the computer. Code and tool results returned
to a cloud-hosted model are processed by that model's provider through its usual
client connection. Local MCP transport does not make a cloud model run offline.

## Troubleshooting and validation

- **Tools appear but requests fail:** open Sourcefield, choose a project or saved
  map, and wait for analysis to finish.
- **Command not found:** use an absolute Node executable path and absolute
  server path. Restart the client after changing its configuration.
- **Project changed:** get a fresh overview/search and use its new project ID.
- **Missing code or edges:** inspect diagnostics. Dynamic calls, external
  dependencies and unsupported syntax can remain unresolved.
- **No complete source in a map:** saved previews are intentionally bounded.
- **Scan in progress:** wait until it finishes before requesting graph tools.

```sh
npm run smoke:mcp
```

This short integration check exercises two independent MCP SDK clients against
the stdio server, including the source CLI launcher and a standalone bundled
copy. It checks all ten tools, real cross-file callers, source ranges,
pagination, view-command acknowledgement through a renderer stub, scope and
authentication failures, offline map previews, stale project IDs, and Explorer
argument parsing. It does not log in to or automate the Claude or ChatGPT apps.

## Dependency scan scope

Installed dependency folders are excluded by default. `sourcefield_project_overview` returns `scan_scope` with the inclusion setting, excluded-folder count and up to 20 example paths/reasons (or null for older maps). Symbol and source searches cover the scanned inventory. Excluded libraries may appear as external/unresolved targets, not searchable source nodes.

In the desktop app, View settings → Show dependency code rescans the open folder to include recognized dependency roots. A successful rescan changes the project ID; clients must obtain the new ID. The setting and bounded exclusion report survive map export/reopen. An offline saved map cannot add files that were never exported.
