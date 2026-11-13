# Releasing Altus +

The in-app updater (`src/updater.ts`, electron-updater) reads the latest
**published, non-prerelease** GitHub release of `lukethehawk/altus-plus` and needs
three files attached to it:

| File | Purpose |
|---|---|
| `Altus-Plus-Setup-<version>.exe` | the NSIS installer |
| `latest.yml` | version, file name and SHA512 the app verifies before installing |
| `Altus-Plus-Setup-<version>.exe.blockmap` | lets the next update download only what changed |

A release without `latest.yml` is ignored by the updater (users get an error
on a manual check and nothing on startup).

## Steps

1. Bump `version` in `package.json` (e.g. `5.8.1-plus.3` → `5.8.1-plus.4`) in
   the PR, merge it into `master`.
2. Wait for the **Altus + Windows installer** run on `master` and download its
   `Altus-Plus-Windows` artifact: it contains the three files above, built
   with `yarn install --immutable`.
3. Check that `latest.yml` names the same version and that its `sha512`
   matches the installer.
4. Create the release on the merge commit, tag `v<version>`, attach the three
   files, publish it as **Latest** (not as a pre-release).

Running installs download the update in the background, offer "Restart now /
Later", and otherwise install it silently the next time the app quits.

## Electron updates

Electron ships Chromium security fixes in its patch releases, usually
without an npm advisory. The **Electron updates** workflow
(`.github/workflows/electron-release.yml`) runs every Monday and fails, so
GitHub emails the owner, when:

- a newer release of the pinned major line is out. The run summary lists
  each one with its date, Chromium version and release notes;
- the pinned major line is no longer supported. Electron supports the
  latest three major versions.

It warns without failing when the pinned line becomes the oldest supported
one, which leaves time to plan the move to a new major.

Checking once a week gathers Electron's frequent patch releases into one
update. To check sooner, for example when an actively exploited Chromium bug
is in the news, run it by hand: Actions → **Electron updates** → **Run
workflow**.

When it fails:

1. In one PR, set `electron` in `package.json` to the newest exact version
   from the run summary, run `yarn install`, and bump `version` to the next
   `-plus.N`.
2. Read the release notes in between. The PR's smoke test (see
   `TESTING-ELECTRON44.md`) covers startup, tabs, the installer and the
   fuses. Run the manual regression checks there that the notes touch, then
   merge.
3. Release as described above.

Moving to a new major is a separate, planned change.

## Testing the updater locally

`ALTUS_TEST_UPDATE_FEED` (read at build time by `vite.main.config.ts`) points a
build at a generic feed instead of GitHub; release builds never set it.

1. Build the "new" version with `yarn make -p win32` and serve `out/make`
   (installer, `latest.yml`, `.blockmap`) over HTTP, e.g. on port 8765.
2. Build an older version with
   `ALTUS_TEST_UPDATE_FEED=http://127.0.0.1:8765/ yarn package -p win32`.
3. Run it with `--user-data-dir` on a throwaway profile and use
   Help → Check for Updates. A test build also checks again on its own
   every minute (release builds: every 6 hours): to test that, serve a
   `latest.yml` with the old version first and put the new files in place
   after the startup check.
4. Never choose "Restart now" in the "Update ready" dialog, which also
   appears on its own after a background download: it installs the new
   build for real (`%LOCALAPPDATA%\Programs\Altus +`) and starts it on the
   default profile. Stop the test app by PID instead (a normal quit installs
   the downloaded update too). If it got installed, uninstall it with
   `"Uninstall Altus +.exe" /currentuser /S`; the profile stays.

Downloads are cached in `%LOCALAPPDATA%\altus-plus-updater`.
