# Developer workbench

Open a local project, then choose **Workbench** in the toolbar or status bar.
The graph starts with folders and files. Search reveals a symbol's direct
neighborhood; the scope selector switches between Structure, All symbols, and
Focused code. The network button switches to a directed flat view (up to 160
nodes and 500 relationships). Arrows point from source to target. Use Back and
Forward to revisit symbols, and Open in VS Code to navigate to the source line.

## Changes

Compare **HEAD** to review staged, unstaged, and untracked source together. Enter
another local Git revision, such as main, to compare the scanned working tree
against that revision. This is a comparison with the working tree, not a
three-dot merge-base comparison. Commit the desired base locally first.

Refresh before comparing when source has changed. Results include changed and
removed declarations, incoming relationship paths, candidate tests and entry
points, added/removed relationships, new import cycles and new violations of
saved architecture rules. These are potential review targets, not predictions
of failures or proof that all affected code was found. An edge is evidence of a
static relationship, not proof that a particular edit changes its behaviour.
Deleted-symbol impact uses base-revision relationships.

Comparisons run in a worker and materialize a temporary, bounded copy of the
base revision without checking out or modifying your working tree. Git external
diff drivers and text conversion are disabled. Symlinks and submodules are not
materialized. Base analysis is limited to 12,000 tracked files and 128 MiB of
materialized data. Installed dependencies absent from Git cannot be reconstructed
in the base graph. Comparing a scoped subdirectory keeps paths relative to it.

**Find files that changed together** inspects the last 200 commits, excluding
bulk commits over 50 files. A suggestion needs at least two shared commits and
includes the commit IDs. Co-change is a review hint, not a required companion edit.

## Features

Sourcefield recognizes explicit JavaScript/TypeScript JSX event bindings,
Electron IPC requests and handlers, Express-style app/router/server HTTP routes,
command registrations, event listeners and timer tasks. Evidence shows the
registration syntax and source location. Literal Electron channel names join
requesting symbols to handlers using the **Messages** relationship layer.
Dynamic channels and framework-specific conventions outside these patterns may
remain unresolved. HTTP routes are entry points; Sourcefield does not assume a
client URL identifies a particular local service. The graph is static and does
not claim to reconstruct every possible execution path.

## Investigations and tours

Create an investigation, select symbols on the map or through search, and add
the selected nodes. Notes and open questions save when their fields lose focus.
Save the current camera and layer settings, restore it later, or focus the
selected task code. Suggested connected code is shown for you to inspect and
add or prune manually. Copy context returns saved previews and relationship
metadata for an AI client. MCP exposes the same task context.

Tours contain ordered symbol anchors and explanatory notes. Select a step to
navigate; Next step advances through the tour. Symbol anchors show **current**,
**changed**, or **missing** after refresh. Semantic IDs survive source inserted
before declarations; a rename, move, or reordering of duplicate sibling names
can still require re-anchoring. Source fingerprints identify content changes.

Investigations, tours and path-prefix boundary rules are saved per project in
the app's user settings and embedded in exported maps. Older version-1 snapshots
still open. Imported maps provide their saved previews; local file reads, Git
comparisons, refresh and editor navigation require opening the project folder.

## Activity and source refresh

Activity records successful and failed requests made through Sourcefield's MCP
server, queried nodes, returned search IDs, source ranges and inspected edge
IDs where available. It records at most 300 requests. It does not monitor other
AI tools, claim an assistant understood a read, or attribute file edits to an AI.
Select an investigation in Activity to compare observed edits with planned scope.

A recursive source watcher marks changed paths. Auto refresh is opt-in in the
status bar; manual Refresh is always available for a local project. Generated
folders, dependency roots and settings directories are filtered. Watcher failure
is reported in Activity. On refresh, unchanged language-analysis groups are
reused by content hash; a changed group is reanalyzed as a whole to keep its
relationships consistent. This is group-level incremental reuse, not per-symbol
incremental type checking. Stable positions, camera and valid selections survive.
The 3D renderer redraws during interaction/animation and when state changes,
and skips stationary scene renders. Picking is throttled to 25 checks per second.

## Architecture

Rules prohibit imports between source and target path prefixes, such as src/
and electron/. The rule check returns the concrete edge and its location.
Import cycle groups use strongly connected components; ordinary symbol
reference cycles are not labelled architectural defects. Git comparisons show
new cycles and violations relative to the base graph.

## Debug imports

Paste text or import a file up to 8 MiB:

- Stack traces: JavaScript-style file:line frames, JVM/Kotlin file:line frames,
  and Python File "path", line N frames. Ambiguous basenames are left unmatched.
- Coverage: LCOV SF/DA records with hit counts. A mapped line may resolve to a
  containing declaration; zero hits do not prove dead code.
- Runtime traces: OTLP JSON resourceSpans/scopeSpans or a spans array. Mapping
  requires code.file.path/code.filepath and optionally code.line.number/code.lineno
  attributes. Span names, trace IDs, parent IDs and status are retained in the
  displayed details. Uninstrumented or unmapped code remains unknown.

These imports are observations displayed beside the static graph, not source
execution, a debugger, or a complete performance profiler. Missing source
attributes and unmatched frames are reported. Import data is transient and is
not silently persisted into shared snapshots.

## Validating usefulness

`npm run test:core` checks known-positive and known-negative graph cases, Git
impact, snapshot portability and scoped source access. For usability testing,
ask developers to locate a feature, identify consumers of a change, and review
an omitted companion edit in an unfamiliar repository. Compare time and correct
findings with their usual tools, count false/missing relationships, and ask
whether they return for a second task. Automated checks do not substitute for
these human measurements.
