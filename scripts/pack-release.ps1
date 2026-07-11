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
# Run after `cargo tauri build`. Emits the two release assets into the same
# `target/release/bundle/nsis` directory (already gitignored via `target/`).
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$conf = Get-Content (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version = $conf.version

$nsisDir = Join-Path $repo 'src-tauri/target/release/bundle/nsis'
$src = Join-Path $nsisDir "Siphon_${version}_x64-setup.exe"
if (-not (Test-Path $src)) {
    throw "NSIS installer not found: $src`nRun 'cargo tauri build' in src-tauri first."
}

$dest = Join-Path $nsisDir "Siphon.Setup.${version}.exe"
Copy-Item $src $dest -Force

$hash = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower()
$shaFile = "$dest.sha256"
"$hash  Siphon.Setup.${version}.exe" | Set-Content -NoNewline -Path $shaFile -Encoding ascii

Write-Host "Release assets ready (v$version):"
Write-Host "  installer : $dest"
Write-Host "  checksum  : $shaFile"
Write-Host "  sha256    : $hash"
