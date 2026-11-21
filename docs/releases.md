# Builds, releases and updates

The GitHub workflow builds Windows NSIS + portable EXE, macOS DMG + ZIP and Linux
AppImage artifacts on their native runners. It checks types and runs all core
regressions before packaging. Publishing occurs only after all platforms pass,
so the release and updater metadata become available together.

Bump package.json and package-lock.json to a new stable version and push to main,
push a matching vVERSION tag, or dispatch Build and publish Sourcefield in
GitHub Actions. An existing published release is left intact. The workflow's
built-in GITHUB_TOKEN needs contents:write; no personal token is needed in CI.

For a local native build and publication:

```
npm ci
npm run release
```

Set GH_TOKEN in the environment to a token with contents:write for
https://github.com/overlytiwa/sourcefield. Never put it in source or config files.
`npm run release -- --help` explains target flags. The script builds, tests,
packages and publishes the current platform using electron-builder. CI is the
recommended route to a complete multi-platform release. Re-running local
publication may add artifacts to an existing release; bump the version for a
new updater release.

The assisted Windows installer displays resources/license.txt, copied verbatim
from the MIT LICENSE, and registers .sourcefield with the app. The existing
single-instance file-open handling opens maps from Explorer. Windows may require
the user to choose the default application if another application already owns
a protected default association. The portable EXE does not run an installer or
register a machine association.

Packaged supported installations check GitHub for updates after 15 seconds and
every four hours. Downloads run asynchronously in the main process. The
updater validates update artifacts using its release metadata and installs a
pending update on normal application quit/restart. It never forces a restart
while someone is working. A small notice reports a completed download. Failed
or offline checks are logged and retried on the next interval. Development and
Windows portable launches skip update checks. SOURCEFIELD_DISABLE_UPDATES=1
is available for managed or offline deployments.

macOS automatic updates require a signed build and the ZIP update artifact.
Configure CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
and APPLE_TEAM_ID as GitHub secrets to sign/notarize macOS releases. Without
signing credentials the workflow can publish an unsigned macOS download, but
automatic installation on macOS is not supported. Signing credentials are never
created or guessed by the workflow. NSIS is the supported Windows updater target;
Linux updates use the AppImage path and may require writable install permissions.

Automatic installation is validated by the updater integration and packaging
checks; a real upgrade from an installed prior release should also be exercised
on each target OS before distributing to a large user base.
