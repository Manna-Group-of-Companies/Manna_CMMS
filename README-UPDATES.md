# Over-the-air updates for the StockMaster tablets

The Android app checks a `version.json` file on every launch. If the published
version is newer than the installed one it offers an update, downloads the APK,
and opens Android's package installer.

Everything is served by **GitHub**. There is no hosting service, no account for
the tablets, and nothing to pay for — the repository is public, so both files
are ordinary anonymous downloads:

| What | Where | URL the app uses |
| --- | --- | --- |
| the manifest | [`update/version.json`](update/version.json), committed to `main` | `raw.githubusercontent.com/Manna-Group-of-Companies/Manna_CMMS/main/update/version.json` |
| the APK | an asset on the [GitHub release](https://github.com/Manna-Group-of-Companies/Manna_CMMS/releases) tagged `v<version>` | named in full by `apkUrl` inside the manifest |

Publishing an update is therefore a `git push` plus a release upload.

**Android cannot install an APK silently.** A normal app (not a system app, not
a device-owner enrolled through an MDM) is not permitted to. What this system
does is download the file and hand it to the stock installer — the user taps
*Install*, Android verifies the signature, and upgrades the app in place. The
existing app is never uninstalled and its data is untouched.

---

## One-time setup

### 1. Hosting — nothing to do

Already configured in
[mobile/lib/core/update_config.dart](mobile/lib/core/update_config.dart). The
repo being public is the only requirement; if it is ever made private the
tablets will start getting 404s, because their downloads carry no credentials.

The URL can be overridden per build without editing any source:

```powershell
flutter build apk --release --dart-define=UPDATE_BASE_URL=https://example.com/somewhere
```

### 2. Optional: the GitHub CLI

`tools/publish_update.ps1` uploads the APK for you when `gh` is installed, and
otherwise pauses and tells you where to drop the file by hand. Installing it
makes a release a single command:

```powershell
winget install --id GitHub.cli
gh auth login
```

### 3. Set up release signing

This is the part that will silently bite you later if you skip it.

An update can only install over the app already on a tablet when **both APKs
are signed with the same key**. Right now the project falls back to Android's
*debug* key, which lives in `%USERPROFILE%\.android\debug.keystore`, is
different on every machine, and expires. Build a release on a second computer
and every tablet will refuse the update with "App not installed".

```powershell
cd "c:\MANNA DEVELOPES\Manna_CMMS\mobile\android"
keytool -genkey -v -keystore stockmaster-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias stockmaster
copy key.properties.example key.properties
# then edit key.properties with the passwords you just chose
```

`android/app/build.gradle.kts` picks `key.properties` up automatically; without
it the build keeps using the debug key exactly as before.

⚠ **Switching keys is a one-way door for tablets already in the field.** A
tablet running a debug-signed build cannot be updated to a release-signed one —
Android rejects the signature change. Those tablets need a one-time manual
uninstall + reinstall (which *does* clear their local app data; server data is
unaffected). Do this now, before more tablets are deployed, rather than later.

Back the keystore up somewhere outside this repo. Losing it means every tablet
needs a manual reinstall.

---

## Where the files go

```
Manna_CMMS/
├─ update/
│  └─ version.json               committed and pushed — this IS the publish step
├─ release/                      ← git-ignored; built APKs staged for upload
│  └─ stockmaster-1.0.1.apk      uploaded to the GitHub release, never committed
└─ tools/publish_update.ps1      build → upload → verify → push, one command
```

And on GitHub, one release per version, each carrying one APK:

```
https://github.com/Manna-Group-of-Companies/Manna_CMMS/releases/download/v1.0.1/stockmaster-1.0.1.apk
                                                                        ^tag^   ^asset^
```

APKs are deliberately kept out of git — 54 MB per release would bloat the
repository permanently, and release assets do not live in git history.

Never delete an old GitHub release. A tablet that was switched off during a
rollout may still hold a cached manifest pointing at the previous APK.

### version.json

```json
{
  "latestVersion": "1.0.2",
  "versionCode": 3,
  "apkUrl": "https://github.com/Manna-Group-of-Companies/Manna_CMMS/releases/download/v1.0.2/stockmaster-1.0.2.apk",
  "releaseNotes": ["Faster catalog", "Fixed the returns filter"],
  "fileSize": 54000000,
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "mandatory": false,
  "minSupportedVersion": "1.0.0"
}
```

| Field | Required | What it does |
| --- | --- | --- |
| `latestVersion` | ✅ | Compared against the installed version, segment by segment, so `1.0.10` correctly beats `1.0.9`. |
| `apkUrl` | ✅ | The full GitHub release download URL. Any absolute https URL works, so the APKs can move host without an app change. |
| `versionCode` | | Breaks a tie when `latestVersion` is unchanged — lets you push a rebuild of the same version. |
| `releaseNotes` | | A string, or a list of strings rendered as bullets. |
| `fileSize` | | Bytes. Used to verify the download and to show "8.4 MB of 51.5 MB". |
| `sha256` | | Checked after download; a mismatch is discarded rather than installed. |
| `mandatory` | | Removes the "Later" button for this release. |
| `minSupportedVersion` | | Anything older is forced to update, without flagging each release mandatory. |

Only `latestVersion` and `apkUrl` are required. `tools/publish_update.ps1`
fills in `fileSize` and `sha256` for you.

---

## Publishing an update

### The short way

```powershell
cd "c:\MANNA DEVELOPES\Manna_CMMS"
.\tools\publish_update.ps1 -Version 1.0.1 -Notes "Faster catalog","Fixed the returns filter"
```

That bumps `pubspec.yaml`, builds the signed APK, publishes it as a GitHub
release, **checks the download URL actually resolves**, then rewrites
`update/version.json` and pushes it. Add `-Mandatory` to remove the "Later"
button, or `-SkipManifest` to stop after the upload.

If `gh` is not installed the script pauses and tells you where to drop the APK
by hand, then carries on. Either way it refuses to publish the manifest until
it has confirmed the APK is downloadable — so a failed upload can never leave
tablets chasing a file that isn't there.

### The same thing by hand

**1. Bump the version** in [mobile/pubspec.yaml](mobile/pubspec.yaml). The
number before `+` is the version users see; the number after is Android's
`versionCode`, which must never go backwards.

```yaml
version: 1.0.1+2
```

**2. Build the release APK.**

```powershell
cd "c:\MANNA DEVELOPES\Manna_CMMS\mobile"
flutter build apk --release
```

Output: `mobile\build\app\outputs\flutter-apk\app-release.apk`

> Use `flutter build apk`, not `--split-per-abi`. Split APKs are per-CPU and
> the manifest can only name one file. A single fat APK installs on any tablet.
> Never use `flutter build appbundle` here — an `.aab` is for Play Store upload
> and cannot be installed on a device.

**3. Stage it under the version's own name**, and note its size and hash.

```powershell
copy build\app\outputs\flutter-apk\app-release.apk ..\release\stockmaster-1.0.1.apk
Get-FileHash ..\release\stockmaster-1.0.1.apk -Algorithm SHA256
(Get-Item ..\release\stockmaster-1.0.1.apk).Length
```

**4. Publish it as a GitHub release.** Go to
[releases/new](https://github.com/Manna-Group-of-Companies/Manna_CMMS/releases/new),
set the tag to `v1.0.1` (choose *Create new tag on publish*), attach
`release\stockmaster-1.0.1.apk`, and **Publish release** — not *Save draft*, as
a draft returns 404 to anyone not signed in, which is every tablet.

**5. Confirm it downloads** before you point anything at it:

```powershell
curl.exe -sIL https://github.com/Manna-Group-of-Companies/Manna_CMMS/releases/download/v1.0.1/stockmaster-1.0.1.apk | Select-String "^HTTP"
```

You want a `200` at the end. The `302` before it is GitHub redirecting to its
CDN, which the app follows automatically.

**6. Update [update/version.json](update/version.json)** with the new version,
`versionCode`, `apkUrl`, notes, size and hash.

**7. Push it.** This is the publish — until the commit is on `main`, the
tablets still see the old manifest.

```powershell
git add update/version.json mobile/pubspec.yaml
git commit -m "Release 1.0.1"
git push
```

Always publish the APK *before* pointing the manifest at it, or tablets will be
offered a release they cannot download. `publish_update.ps1` enforces that
order and refuses to continue if the URL does not resolve.

### Verify

```powershell
curl.exe -s "https://raw.githubusercontent.com/Manna-Group-of-Companies/Manna_CMMS/main/update/version.json"
```

Then restart the app on a tablet — the prompt appears within a second or two of
launch.

---

## The version train

Version comparison is numeric per segment, so the sequence works exactly as
you would expect and keeps working past `.9`:

```
1.0.1 → 1.0.2 → 1.0.3 → 1.0.4 → … → 1.0.9 → 1.0.10 → 1.1.0 → 2.0.0
```

A tablet on 1.0.1 that misses two rollouts jumps straight to 1.0.4 — there is
no upgrade chain to walk. A tablet on a *newer* version than the manifest (a
test build, or a rolled-back release) is never downgraded.

---

## How it behaves on the tablet

| Situation | What happens |
| --- | --- |
| No internet, or GitHub unreachable | The startup check fails silently and the app carries on. Nothing is blocked. |
| No update available | Nothing is shown at startup. Settings says "StockMaster 1.0.1 is up to date." |
| Update available | Dialog: current version, latest version, release notes, **Update Now** / **Later**. |
| "Later" tapped | That version is remembered and not offered again at startup. **Check for Updates** in Settings still shows it. |
| "Update Now" tapped | Progress bar with a percentage, then the Android installer opens. |
| Download interrupted | The partial file is discarded and the next attempt starts fresh. |
| Same version already downloaded | The cached APK is reused — size and SHA-256 are checked first. It is never downloaded twice. |
| "Install unknown apps" not granted | The app sends the user to the right settings screen, then continues once they come back. Granted once per tablet. |
| Corrupt download | Rejected on the SHA-256 or size check and deleted rather than installed. |
| Release flagged `mandatory` | No "Later", and back/tap-outside will not dismiss the dialog. |

The APK is written to the app's own cache directory
(`/data/data/com.mannarubber.stockmaster/cache/updates/`) — private to the app,
no storage permission needed, and reclaimed by Android when space runs short.
Older APKs there are pruned on each successful download.

---

## Where the code lives

| File | Role |
| --- | --- |
| [mobile/lib/core/update_config.dart](mobile/lib/core/update_config.dart) | The manifest URL and every tunable. The only file you edit for setup. |
| [mobile/lib/core/update_service.dart](mobile/lib/core/update_service.dart) | Version parsing and comparison, manifest fetch, download with progress, verification. |
| [mobile/lib/core/update_storage_io.dart](mobile/lib/core/update_storage_io.dart) | Where the APK is written; streaming SHA-256. (`_stub.dart` is the web no-op.) |
| [mobile/lib/core/apk_installer.dart](mobile/lib/core/apk_installer.dart) | Dart side of the installer bridge. |
| [mobile/lib/widgets/update_dialog.dart](mobile/lib/widgets/update_dialog.dart) | The dialog, plus the startup and Settings entry points. |
| [mobile/android/.../MainActivity.kt](mobile/android/app/src/main/kotlin/com/mannarubber/stockmaster/MainActivity.kt) | Opens the package installer; asks for the install permission. |
| [mobile/android/app/src/main/res/xml/update_file_paths.xml](mobile/android/app/src/main/res/xml/update_file_paths.xml) | Folders the `FileProvider` may share. Must match `UpdateConfig.cacheFolder`. |

The check runs from `main.dart`, chained after session restore so the dialog is
not raised over the splash screen. It is skipped entirely in widget tests,
which inject their own `ApiClient`.

---

## Troubleshooting

**The dialog never appears.** Open the manifest URL in the tablet's browser. If
it 404s, the commit was never pushed, or the repository was made private.
Also confirm `latestVersion` is actually higher than what the tablet has —
Settings → App Version shows the installed one.

**The download fails on the tablet but the URL works in your browser.** Check
the GitHub release is *published* rather than saved as a draft: drafts return
404 to anyone not signed in, which is every tablet.

**"App not installed" on the tablet.** The signatures differ. Either the APK
was built with a different keystore than the installed copy, or you have just
switched from the debug key to a release key. Uninstall and reinstall once.

**The installer does not open.** Settings → Apps → StockMaster → "Install
unknown apps" must be allowed. The app offers to take the user there, but some
locked-down or MDM-managed tablets block the permission outright.

**A tablet sees a stale version.** `raw.githubusercontent.com` caches for five
minutes, and the app appends a cache-busting query parameter to defeat it. If
it persists beyond that, the push probably did not land — check the file on
`main` on github.com.
