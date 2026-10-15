param(
    [Parameter(Mandatory = $true)][int]$TargetPid,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutable
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$expectedPath = [IO.Path]::GetFullPath($ExpectedExecutable)
if (-not $expectedPath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Fixture cleanup executable must be inside the separate development project.'
}
$ownedProcess = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
if ($null -eq $ownedProcess) { exit 0 }
try {
    # Keep its process handle open during identity verification and termination.
    # This prevents the PID from being reused while taskkill resolves it.
    $null = $ownedProcess.Handle
    if (-not [string]::Equals($ownedProcess.Path, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Fixture cleanup refused: process executable does not match this test.'
    }
    & "$env:SystemRoot\System32\taskkill.exe" /PID $TargetPid /T /F 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0 -and -not $ownedProcess.HasExited) {
        throw 'Fixture cleanup could not stop its verified process.'
    }
} finally {
    $ownedProcess.Dispose()
}
