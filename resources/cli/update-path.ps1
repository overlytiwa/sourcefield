param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Add', 'Remove')]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [string]$Directory,
    [ValidateSet('User', 'Machine', 'Process')]
    [string]$Scope = 'User'
)
$ErrorActionPreference = 'Stop'

# Use .NET rather than NSIS string buffers so long PATH values remain intact.
function Normalize-Directory([string]$Value) {
    return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"')).TrimEnd('\', '/')
}
$registry = $null
if ($Scope -eq 'Process') {
    $current = [Environment]::GetEnvironmentVariable('Path', 'Process')
} else {
    $hive = [Microsoft.Win32.Registry]::CurrentUser
    $key = 'Environment'
    if ($Scope -eq 'Machine') {
        $hive = [Microsoft.Win32.Registry]::LocalMachine
        $key = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
    }
    $registry = $hive.CreateSubKey($key)
    # Keep expandable entries such as %USERPROFILE% exactly as written.
    $current = $registry.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    if ($null -ne $current) { $kind = $registry.GetValueKind('Path') }
}
try {
$parts = @()
if ($null -ne $current -and $current -ne '') { $parts = $current.Split(';') }
$target = Normalize-Directory $Directory
$found = $false
$next = @(foreach ($part in $parts) {
    if ((Normalize-Directory $part) -ieq $target) {
        if ($Action -eq 'Add' -and -not $found) { $part }
        $found = $true
    } else { $part }
})
if ($Action -eq 'Add' -and -not $found) { $next += $Directory }
$updated = $next -join ';'
if ($updated -cne $current) {
    if ($Scope -eq 'Process') {
        [Environment]::SetEnvironmentVariable('Path', $updated, 'Process')
    } else {
        $registry.SetValue('Path', $updated, $kind)
    }
}
} finally {
    if ($null -ne $registry) { $registry.Dispose() }
}
