# Field Notes

A small runnable JavaScript project for exploring Sourcefield. No dependencies.

Run `npm start`, or `npm start -- ideas`, in this folder.

Open this folder in Sourcefield and search for `matchesQuery`. The callback in
`Notebook.search` calls `matchesQuery` in `search.js`, which calls `normalize`.
This is a real cross-file call chain. Export the map, move this folder, and reopen
the map to explore the saved snapshot without the source.
