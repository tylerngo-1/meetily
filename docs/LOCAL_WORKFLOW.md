# Local Workflow: Developing Meetily While Using It Daily

This fork is used two ways on the same Mac:

| | Dev app | Daily app |
|---|---|---|
| Purpose | Build and test features | Real meetings |
| Run | `pnpm run tauri:dev` (from `frontend/`) | `/Applications/meetily.app` |
| App identifier | `com.meetily.ai.dev` | `com.meetily.ai` |
| Data folder | `~/Library/Application Support/com.meetily.ai.dev/` | `~/Library/Application Support/com.meetily.ai/` |
| Built from | Any branch | `main` only, via `install_local.sh` |

The two apps never share a database, settings or models, so a dev build cannot break the daily app.
Shared between them: audio recordings in `~/Movies/meetily-recordings/` (folder names are unique)
and notification settings.

## Branches

```
upstream/main   official Meetily (Zackriya-Solutions/meetily)
      │ merge occasionally (sync/* branch)
      ▼
origin/main     this fork: what is installed, or ready to install
      ▲
      │ merge when tested in the dev app
enhance/*, fix/*   feature work
```

- Never commit directly to `main`.
- Merge into `main` only after the change works in the dev app.
- Every install tags the commit as `installed/<version>` (local tags, not pushed).
  `git tag -l 'installed/*'` shows the install history; the newest tag is what is installed.

## Working on a feature

```bash
git checkout main && git checkout -b enhance/<name>
cd frontend
pnpm run tauri:dev        # hot reload for UI changes; Rust changes rebuild automatically
```

Use `./clean_run.sh` only when dependencies changed or the build is in a strange state
(it reinstalls `node_modules` every time).

## Installing to the daily app

```bash
git checkout main
git merge enhance/<name>
cd frontend && ./install_local.sh
```

`install_local.sh`:

1. Refuses to run unless you are on a clean `main` (`--any-branch` overrides the branch check).
2. Builds the app with `src-tauri/tauri.local.conf.json` and the version `<base>-local.<N>`
   (for example `0.4.1-local.3`). The daily app keeps running during the build.
3. Asks before quitting Meetily. Do not confirm while recording.
4. Backs up the data folder (without models) and the current app to
   `~/Library/Application Support/meetily-backups/<timestamp>_before_<version>/`.
   The newest 5 backups are kept.
5. Installs the new app, tags the commit, and relaunches Meetily.

macOS may ask for microphone and screen recording permission again after an install,
because every local build has a new ad-hoc signature.

### What `tauri.local.conf.json` changes

- `bundle.createUpdaterArtifacts: false`: the official config signs updater files with the
  upstream team's private key, which this fork does not have.
- The in-app update check points at this fork's GitHub releases instead of the official ones.
  Otherwise the official updater would offer to replace this build with an upstream release
  that lacks this fork's features and migrations. No `latest.json` is published there, so the
  startup check fails silently and a manual "Check for updates" shows an error. That is expected.

## Pulling official updates

```bash
git checkout main && git checkout -b sync/upstream-<version>
git fetch upstream
git merge upstream/main        # resolve conflicts
cd frontend && pnpm run tauri:dev   # test, especially recording and saving
git checkout main && git merge sync/upstream-<version>
./install_local.sh
```

Check `frontend/src-tauri/migrations/` after merging: upstream migrations and this fork's
migrations must all be present, and none of them may be renamed.

## Database migrations: rules

Migrations run automatically at startup and cannot be undone by the app. An app that does not
know a migration recorded in the database refuses to start
(`migration ... was previously applied but is missing in the resolved migrations`).

1. A new migration runs in the dev app first. Install only after it has worked there.
2. Never edit, rename or delete a migration file after it has run anywhere.
   When contributing a feature upstream, ask for the migration filename to be kept.
3. Never accept an update from the official in-app updater while this fork's migrations
   are in your database.
4. An older app cannot open a database with newer migrations. Rolling back needs both the
   old app and the matching data backup (see below).

## Rolling back the daily app

Quit Meetily, then restore both the app and the data from the same backup folder:

```bash
BACKUP="$HOME/Library/Application Support/meetily-backups/<timestamp>_before_<version>"
rm -rf /Applications/meetily.app
ditto "$BACKUP/meetily.app" /Applications/meetily.app
rsync -a --exclude "models/" --delete "$BACKUP/data/" "$HOME/Library/Application Support/com.meetily.ai/"
```

Meetings recorded after that backup are lost from the database (their audio stays in
`~/Movies/meetily-recordings/`). Delete the newest `installed/*` tag so the history stays accurate:
`git tag -d installed/<version>`.

## Refreshing the dev app's data

To test with your current real meetings, replace the dev data with a copy of the daily data
(Meetily and the dev app both closed). This discards the dev data.

```bash
rm -rf ~/Library/Application\ Support/com.meetily.ai.dev
cp -c -R ~/Library/Application\ Support/com.meetily.ai ~/Library/Application\ Support/com.meetily.ai.dev
```

`cp -c` clones files on APFS, so the copied models take no extra disk space.
The dev app then applies any migrations from your branch to that copy only.
