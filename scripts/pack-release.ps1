#Requires -Version 7
# Post-build packaging for a Siphon release.
#
# Tauri's NSIS bundler emits `Siphon_<version>_x64-setup.exe` with no checksum.
# The in-app auto-updater (`siphon-core::updater` + `updater_bin.rs`) and the
# winget-publish workflow both expect the installer to be named
# `Siphon.Setup.<version>.exe` with a sibling `.sha256` sidecar. This script
# reconciles the two: it copies the Tauri artifact to the expected name and
# writes a lowercase-hex SHA-256 sidecar (the updater compares against the
# lowercase digest Rust produces).
#
# It also publishes a portable build: `cargo tauri build` leaves the raw
# `[[bin]]` at `target/release/siphon.exe` (a self-contained native binary — no
# runtime folder, unlike the old Electron build). This is copied to
# `Siphon.Portable.<version>.exe` beside the installer, with its own `.sha256`.
# The portable exe needs the WebView2 runtime (bundled in Win11; installed
# on-demand on older Win10) and still stores state under %APPDATA%\Siphon.
#
# Run after `cargo tauri build`. Emits the installer assets into
# `target/release/bundle/nsis` and the portable assets alongside them (all
# gitignored via `target/`).
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$conf = Get-Content (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version = $conf.version

# Emit a `<file>.sha256` sidecar with the lowercase-hex digest the updater/winget
# tooling expects: "<hash>  <basename>".
function Write-Sha256Sidecar {
    param([string]$Path)
    $hash = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLower()
    "$hash  $(Split-Path -Leaf $Path)" | Set-Content -NoNewline -Path "$Path.sha256" -Encoding ascii
    return $hash
}

# --- Installer (NSIS) ---
$nsisDir = Join-Path $repo 'src-tauri/target/release/bundle/nsis'
$src = Join-Path $nsisDir "Siphon_${version}_x64-setup.exe"
if (-not (Test-Path $src)) {
    throw "NSIS installer not found: $src`nRun 'cargo tauri build' in src-tauri first."
}

$dest = Join-Path $nsisDir "Siphon.Setup.${version}.exe"
Copy-Item $src $dest -Force
$hash = Write-Sha256Sidecar $dest

# --- Portable (raw binary) ---
$portableSrc = Join-Path $repo 'src-tauri/target/release/siphon.exe'
if (-not (Test-Path $portableSrc)) {
    throw "Portable binary not found: $portableSrc`nRun 'cargo tauri build' in src-tauri first."
}

$portableDest = Join-Path $nsisDir "Siphon.Portable.${version}.exe"
Copy-Item $portableSrc $portableDest -Force
$portableHash = Write-Sha256Sidecar $portableDest

Write-Host "Release assets ready (v$version):"
Write-Host "  installer : $dest"
Write-Host "  checksum  : $dest.sha256"
Write-Host "  sha256    : $hash"
Write-Host "  portable  : $portableDest"
Write-Host "  checksum  : $portableDest.sha256"
Write-Host "  sha256    : $portableHash"
