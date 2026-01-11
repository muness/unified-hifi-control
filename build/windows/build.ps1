# Build Windows MSI installer for Unified Hi-Fi Control
# Requires: WiX Toolset v3 (https://wixtoolset.org/)

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [Parameter(Mandatory=$true)]
    [string]$BinaryPath,

    [string]$OutputPath = ".\dist\installers"
)

$ErrorActionPreference = "Stop"

Write-Host "`nBuilding Unified Hi-Fi Control MSI v$Version`n" -ForegroundColor Cyan

# Verify WiX is installed
$wixPath = "${env:WIX}bin"
if (-not (Test-Path $wixPath)) {
    # Try common install locations
    $commonPaths = @(
        "C:\Program Files (x86)\WiX Toolset v3.11\bin",
        "C:\Program Files (x86)\WiX Toolset v3.14\bin",
        "C:\Program Files\WiX Toolset v3.11\bin"
    )
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            $wixPath = $path
            break
        }
    }
}

if (-not (Test-Path "$wixPath\candle.exe")) {
    Write-Error "WiX Toolset not found. Install from https://wixtoolset.org/"
    exit 1
}

Write-Host "Using WiX from: $wixPath"

# Verify binary exists
if (-not (Test-Path $BinaryPath)) {
    Write-Error "Binary not found: $BinaryPath"
    exit 1
}

# Create output directory
New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

# Build paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$wxsFile = Join-Path $scriptDir "installer.wxs"
$wixobjFile = Join-Path $OutputPath "installer.wixobj"
$msiFile = Join-Path $OutputPath "unified-hifi-control-$Version.msi"

# Compile WiX source
Write-Host "`nCompiling WiX source..."
& "$wixPath\candle.exe" `
    -dVersion=$Version `
    -dBinaryPath=$BinaryPath `
    -ext WixUtilExtension `
    -out $wixobjFile `
    $wxsFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "WiX compilation failed"
    exit 1
}

# Link to create MSI
Write-Host "Linking MSI..."
& "$wixPath\light.exe" `
    -ext WixUIExtension `
    -ext WixUtilExtension `
    -cultures:en-us `
    -out $msiFile `
    $wixobjFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "WiX linking failed"
    exit 1
}

# Cleanup intermediate files
Remove-Item $wixobjFile -ErrorAction SilentlyContinue

# Get file size
$fileSize = (Get-Item $msiFile).Length / 1MB
Write-Host "`n✓ Created: $msiFile ($([math]::Round($fileSize, 1)) MB)" -ForegroundColor Green

Write-Host "`nTo sign the MSI (optional):"
Write-Host "  signtool sign /a /t http://timestamp.digicert.com `"$msiFile`""
