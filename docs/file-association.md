# Open Sourcefield maps from Explorer / Inno

The program accepts a map path directly:

```bat
"C:\Program Files\Sourcefield\Sourcefield.exe" "C:\Projects\My map.sourcefield"
```

The explicit form is recommended for an Inno `open` command:

```bat
"C:\Program Files\Sourcefield\Sourcefield.exe" --map "%1"
```

Use your actual executable name and installation path. Keep the executable
and `%1` quoted so spaces in either path work. Configure the association for
`.sourcefield` in your installer; Sourcefield does not modify the registry itself.

On a cold start, the app validates and opens the map after the renderer is ready.
When it is already running, the single-instance handler restores/focuses the
existing window and opens the requested map there. A map launched while a scan
is running cancels that scan before opening. Map extensions are recognized
without case sensitivity, including `.SOURCEFIELD`.

Opening from Explorer uses the same validated snapshot reader as the native
Open Map dialog. It preserves graph coordinates and relationships and requires
no access to the original source folder. On macOS, OS file-open events are also
handled. Electron Builder's built-in file association metadata remains present
for installers built through `npm run dist`.
