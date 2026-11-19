# Sourcefield map format, version 1

Extension: `.sourcefield`. MIME type: `application/x-sourcefield`.

## Encoding

The first 14 bytes are `SOURCEFIELD`, NUL, the byte `0x01`, and a newline:

```text
53 4f 55 52 43 45 46 49 45 4c 44 00 01 0a
```

The remaining bytes are one gzip stream containing a UTF-8 JSON object. There is
no dependency on an original absolute project directory. A reader must validate
the header, decompress with a maximum output size, parse JSON, then validate the
object. This implementation caps both input and expanded JSON at 256 MiB.

## Root object

The exact TypeScript schema is in `shared/types.ts`; runtime validation is in
`electron/format.ts`.

| Field | Meaning |
| --- | --- |
| `format` | Literal `sourcefield.code-map` |
| `version` | Integer `1`; unknown versions are rejected |
| `createdAt` | ISO timestamp of the scan |
| `project` | Name, enumerated file count, analyzed file count, languages, ignored entry count |
| `nodes` | Actual hierarchy and declaration nodes |
| `edges` | Resolved directed relationships |
| `issues` | Unsupported/skipped files, unresolved/external targets, parse errors, limits |
| `layout` | Algorithm `spherical-graph-v1`, deterministic seed, radius |
| `scan` (optional) | Dependency inclusion setting, excluded dependency-folder count, and up to 1,000 relative paths with detection reasons. Older version-1 maps without this field remain valid. |
| `view` | Optional exact camera, selection, connection visibility and label state |

## Nodes

Every node has a unique string `id`, `name`, `kind`, relative `path`, numeric
`degree`, and finite `[x, y, z]` `position`. Optional fields: `parent`, 1-based
`line`, `column`, `endLine`, `language`, `signature`, `excerpt`, `exported`, and
analysis `status` (`analyzed`, `partial`, `unsupported`, `skipped`).

Kinds are `folder`, `file`, `class`, `function`, `method`, `variable`, `parameter`,
`property`, `interface`, `type`, `enum`, `namespace`, and `import`. Root paths use
`.`. Paths use forward slashes and cannot contain parent traversal components.
Previews include up to 12 lines and 2,400 characters per declaration.

## Edges

Every edge has a unique `id`, valid `source`/`target` node IDs, `kind`, and a
positive occurrence `count`. Kinds: `contains`, `imports`, `exports`, `calls`,
`inherits`, `references`. Source and target encode direction (for example caller
to callee, derived class to base class, parent to child).

Repeated occurrences of one source/target/kind combination are aggregated. The
optional top-level `path` and `line` identify the first known location.
`locations` preserves up to 1,000 distinct locations, each with `path`, `line`,
and optional `column`. Capped location arrays do not discard the aggregate count.

## View

`position` and `target` are finite XYZ triples. `selected` is a valid node ID or
null. `visibleEdges` lists visible edge kinds. `labels` enables/disables the
progressive labeling system; label text itself is recomputed from camera
distance and screen-space collision checks after opening.

Coordinates are stored as numbers and reused directly. Reopening never reruns
layout or source analysis. New scans can produce a different layout if the
graph changes; snapshots always retain their saved coordinates.

## Validation and writes

The reader rejects duplicate IDs, dangling connections, missing parents, cyclic
hierarchies, invalid enum values, non-finite geometry, malformed locations, and
unsupported versions. It never treats source paths or source previews as code
to execute or as paths to reopen. New writes first create a temporary file next
to the destination, then rename it into place.
