<#
.SYNOPSIS
    Publishes a new StockMaster release. GitHub only — no hosting service.

.DESCRIPTION
    Both halves of an update live on GitHub, and the repository is public, so
    the tablets download them anonymously:

      the APK        an asset on the GitHub release tagged v<version>
      the manifest   update/version.json, committed and pushed to main, read
                     by the app through raw.githubusercontent.com

    Steps, in the order that keeps tablets safe:

      1. bumps `version:` in mobile/pubspec.yaml (versionName + versionCode)
      2. builds the release APK into release/
      3. publishes it as a GitHub release asset (via `gh`, or by hand)
      4. CONFIRMS the download URL actually resolves
      5. rewrites update/version.json, then commits and pushes it

    Step 4 is the safety catch: the manifest is only ever published once the
    APK behind it is provably downloadable, so tablets are never offered a
    release they cannot fetch.

.EXAMPLE
    .\tools\publish_update.ps1 -Version 1.0.1 -Notes "Faster catalog","Fixed the returns filter"

.EXAMPLE
    # Rebuild and republish without bumping the build number (a bad upload, say).
    .\tools\publish_update.ps1 -Version 1.0.1 -KeepBuildNumber
#>
[CmdletBinding()]
param(
    # The version the tablets will see, e.g. 1.0.1
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    # Release notes, shown in the update dialog. One string per bullet.
    [string[]]$Notes = @(),

    # Do not let the user postpone this one.
    [switch]$Mandatory,

    # Reuse the current build number instead of incrementing it.
    [switch]$KeepBuildNumber,

    # Build and upload only — leave the manifest alone.
    [switch]$SkipManifest
)

$ErrorActionPreference = 'Stop'

# The repo the tablets download from. Public, so no token is involved.
$GitHubRepo = 'Manna-Group-of-Companies/Manna_CMMS'

# Windows PowerShell's `-Encoding utf8` writes a BOM, and a BOM would break
# both consumers of the files written below: Dart's jsonDecode chokes on a
# leading U+FEFF, and the YAML parser is no happier about one in pubspec.yaml.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileDir = Join-Path $repoRoot 'mobile'
$pubspecPath = Join-Path $mobileDir 'pubspec.yaml'
$releaseDir = Join-Path $repoRoot 'release'
$manifestPath = Join-Path $repoRoot 'update\version.json'

$apkName = "stockmaster-$Version.apk"
$tag = "v$Version"
$downloadUrl = "https://github.com/$GitHubRepo/releases/download/$tag/$apkName"

# ── 1. Bump the version in pubspec.yaml ───────────────────────────────────────
$pubspec = Get-Content $pubspecPath -Raw
$match = [regex]::Match($pubspec, '(?m)^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$')
if (-not $match.Success) {
    throw "Could not find a 'version: x.y.z+n' line in $pubspecPath"
}

$currentVersion = $match.Groups[1].Value
$currentBuild = [int]$match.Groups[2].Value
if ($KeepBuildNumber) { $buildNumber = $currentBuild } else { $buildNumber = $currentBuild + 1 }

Write-Host "Releasing $currentVersion+$currentBuild -> $Version+$buildNumber" -ForegroundColor Cyan
$pubspec = [regex]::Replace($pubspec, '(?m)^version:\s*\d+\.\d+\.\d+\+\d+\s*$', "version: $Version+$buildNumber")
Write-Utf8NoBom $pubspecPath $pubspec

# ── 2. Build the release APK ──────────────────────────────────────────────────
Write-Host "`nBuilding the release APK..." -ForegroundColor Cyan
Push-Location $mobileDir
try {
    & flutter build apk --release
    if ($LASTEXITCODE -ne 0) { throw "flutter build apk failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

$builtApk = Join-Path $mobileDir 'build\app\outputs\flutter-apk\app-release.apk'
if (-not (Test-Path $builtApk)) { throw "The build did not produce $builtApk" }

if (-not (Test-Path $releaseDir)) { New-Item -ItemType Directory -Path $releaseDir | Out-Null }
$stagedApk = Join-Path $releaseDir $apkName
Copy-Item $builtApk $stagedApk -Force

$fileSize = (Get-Item $stagedApk).Length
$sha256 = (Get-FileHash $stagedApk -Algorithm SHA256).Hash.ToLower()
Write-Host "Staged $apkName ($([math]::Round($fileSize / 1MB, 1)) MB)" -ForegroundColor Green

# ── 3. Publish it as a GitHub release asset ───────────────────────────────────
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    Write-Host "`nPublishing the GitHub release $tag..." -ForegroundColor Cyan
    if ($Notes.Count -gt 0) { $ghNotes = ($Notes | ForEach-Object { "- $_" }) -join "`n" } else { $ghNotes = "Version $Version" }

    # `create` fails if the tag is already released; fall back to uploading
    # into the existing one so a re-run repairs a bad upload.
    & gh release create $tag $stagedApk --repo $GitHubRepo --title $tag --notes $ghNotes 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Release $tag exists — replacing the asset." -ForegroundColor Yellow
        & gh release upload $tag $stagedApk --repo $GitHubRepo --clobber
        if ($LASTEXITCODE -ne 0) { throw "gh release upload failed with exit code $LASTEXITCODE" }
    }
}
else {
    Write-Host @"

The GitHub CLI (gh) is not installed, so upload the APK by hand:

  1. https://github.com/$GitHubRepo/releases/new
  2. Tag:   $tag        (choose "Create new tag on publish")
  3. Title: $tag
  4. Attach: $stagedApk
  5. Publish release  --  NOT "Save draft"; a draft is invisible to the tablets

"@ -ForegroundColor Yellow
    Read-Host "Press Enter once the release is published"
}

# ── 4. Confirm the APK is actually downloadable ───────────────────────────────
# Publishing a manifest that points at a missing file would offer every tablet
# an update it cannot install, so this gate is not optional.
Write-Host "Checking $downloadUrl ..." -ForegroundColor Cyan
try {
    $head = Invoke-WebRequest -Uri $downloadUrl -Method Head -MaximumRedirection 5 -UseBasicParsing
    if ($head.StatusCode -ne 200) { throw "HTTP $($head.StatusCode)" }
}
catch {
    throw "The APK is not downloadable at $downloadUrl ($($_.Exception.Message)). The manifest was NOT updated, so the tablets still see the previous release."
}
Write-Host "APK is live." -ForegroundColor Green

if ($SkipManifest) {
    Write-Host "`nSkipping the manifest update." -ForegroundColor Yellow
    exit 0
}

# ── 5. Rewrite the manifest, then commit and push it ──────────────────────────
if ($Notes.Count -gt 0) { $releaseNotes = $Notes } else { $releaseNotes = @("Version $Version") }

$manifest = [ordered]@{
    latestVersion       = $Version
    versionCode         = $buildNumber
    apkUrl              = $downloadUrl
    releaseNotes        = $releaseNotes
    fileSize            = $fileSize
    sha256              = $sha256
    mandatory           = [bool]$Mandatory
    minSupportedVersion = (Get-Content $manifestPath -Raw | ConvertFrom-Json).minSupportedVersion
}
Write-Utf8NoBom $manifestPath ($manifest | ConvertTo-Json -Depth 4)
Write-Host "Wrote update/version.json for $Version" -ForegroundColor Green

# The tablets read the manifest off the main branch, so it is not published
# until it is pushed. pubspec.yaml goes with it to keep the two in step.
Write-Host "`nPushing the manifest..." -ForegroundColor Cyan
Push-Location $repoRoot
try {
    & git add 'update/version.json' 'mobile/pubspec.yaml'
    & git commit -m "Release $Version"
    if ($LASTEXITCODE -ne 0) { throw "git commit failed with exit code $LASTEXITCODE" }
    & git push
    if ($LASTEXITCODE -ne 0) { throw "git push failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

Write-Host "`nPublished $Version. Tablets will be offered the update at their next launch." -ForegroundColor Green
