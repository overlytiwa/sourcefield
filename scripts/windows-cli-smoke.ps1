param([string]$Root, [string]$Temp)
$ErrorActionPreference = 'Stop'
$install = Join-Path $Temp 'installed app'
New-Item -ItemType Directory $install | Out-Null
Copy-Item (Join-Path $Root 'resources/cli/sourcefield.cmd') $install
Copy-Item (Join-Path $Root 'dist-electron/version.txt') (Join-Path $install 'sourcefield-version.txt')
$shim = Join-Path $install 'sourcefield.cmd'
$record = Join-Path $Temp 'installed-launch.json'
$env:SOURCEFIELD_LAUNCH_RECORD = $record

# Use a harmless executable to exercise the real batch launcher without a GUI.
Add-Type -ReferencedAssemblies System.Web.Extensions -OutputAssembly (Join-Path $install 'Sourcefield.exe') -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Web.Script.Serialization;
public class Launcher {
    public static void Main(string[] args) {
        File.WriteAllText(Environment.GetEnvironmentVariable("SOURCEFIELD_LAUNCH_RECORD"),
            new JavaScriptSerializer().Serialize(new {
                args = args, cwd = Environment.CurrentDirectory,
                runAsNode = Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE")
            }));
    }
}
'@
function Read-Launch {
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        try {
            $value = Get-Content -Raw $record | ConvertFrom-Json
            if ($null -ne $value) { return $value }
        } catch {}
        Start-Sleep -Milliseconds 50
    }
    throw 'The installed terminal launcher did not start the application.'
}
Push-Location (Join-Path $Temp 'project with spaces')
try {
    $version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
    if ((& $shim --version).Trim() -ne $version) { throw 'The launcher reported the wrong version.' }
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $shim '.'
    $launch = Read-Launch
    if ($launch.args.Count -ne 1 -or $launch.args[0] -ne '.') { throw 'The launcher lost its directory argument.' }
    if ($launch.cwd -ne (Get-Location).Path) { throw 'The launcher changed the current directory.' }
    if ($null -ne $launch.runAsNode) { throw 'The desktop launcher inherited Node mode.' }
    Remove-Item $record
    & $shim mcp
    $launch = Read-Launch
    if ($launch.runAsNode -ne '1' -or $launch.args[0] -notlike '*resources\mcp\sourcefield-mcp.cjs') {
        throw 'The installed MCP command did not use the bundled runtime and server.'
    }
} finally { Pop-Location }

# Change only the child process PATH; never touch the runner's user/system PATH.
$script = Join-Path $Root 'resources/cli/update-path.ps1'
$original = ('C:\long-folder;' * 400) + '%USERPROFILE%\tools;C:\Sourcefield-other'
$env:Path = $original
& $script -Action Add -Directory 'C:\Sourcefield' -Scope Process
if ($env:Path -cne ($original + ';C:\Sourcefield')) { throw 'PATH content changed or was truncated.' }
& $script -Action Add -Directory 'c:\sourcefield\' -Scope Process
if ($env:Path -cne ($original + ';C:\Sourcefield')) { throw 'PATH registration was not idempotent.' }
& $script -Action Remove -Directory 'C:\Sourcefield' -Scope Process
if ($env:Path -cne $original) { throw 'Uninstall removed unrelated PATH entries.' }
