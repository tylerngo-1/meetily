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
      │ promote when everything on devtest works together
origin/devtest  integration: what the dev app runs day to day
      ▲
      │ merge when the feature is finished
enhance/*, fix/*, docs/*   feature work, branched from main
```

- Never commit directly to `main` or `devtest`.
- Branch features from `main`, not `devtest`, so one unfinished feature never blocks the others.
- Merge only finished work into `devtest`. Promote `devtest` to `main` after it works in the dev app.
  If something on `devtest` is not ready, merge the ready feature branches into `main` individually instead.
- `devtest` must always contain `main`: after every upstream sync, merge `main` into `devtest`.
- If `devtest` gets messy, reset it with `git checkout -B devtest main` and re-merge the branches still in progress
  (then `git push --force-with-lease origin devtest`).
- `upstream/devtest` is unrelated to this fork's `devtest`; only sync from `upstream/main`.
- Every install tags the commit as `installed/<version>` (local tags, not pushed).
  `git tag -l 'installed/*'` shows the install history; the newest tag is what is installed.

## Working on a feature

```bash
git checkout main && git checkout -b enhance/<name>
cd frontend
pnpm run tauri:dev        # hot reload for UI changes; Rust changes rebuild automatically
```

When the feature is finished, test it together with the other work in progress:

```bash
git checkout devtest
git merge --no-ff enhance/<name>
cd frontend && pnpm run tauri:dev
```

Use `./clean_run.sh` only when dependencies changed or the build is in a strange state
(it reinstalls `node_modules` every time).

## Installing to the daily app

```bash
git checkout main
git merge devtest              # or a single ready branch: git merge enhance/<name>
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

Run the steps in one shell (they reuse `$OLD`).

**1. Merge upstream into a sync branch**

```bash
git checkout main && git checkout -b sync/upstream-<version>
git fetch upstream
OLD=$(git merge-base main upstream/main)        # upstream commit we last synced
git diff --stat "$OLD" upstream/main            # what upstream changed (read before merging)
git merge upstream/main                         # then resolve conflicts (step 2)
```

**2. Resolve conflicts and update docs** (in the sync branch)

- **Migrations:** check `frontend/src-tauri/migrations/`. Upstream migrations and this fork's
  migrations must all be present, and none of them may be renamed.
- **Docs:** this fork moved and merged most of upstream's docs, so conflicts on upstream doc files
  are expected. Look each file up in [upstream-map.md](upstream-map.md), apply upstream's change
  (`git diff "$OLD" upstream/main -- <file>`) to the file named there, then mark the conflict
  resolved: `git rm <file>` for files we deleted, or `git checkout --ours <file> && git add <file>`
  for files we rewrote.
- **Code that our docs describe:** compare `git diff --stat "$OLD" upstream/main` with the
  "Upstream code changes that make our docs stale" table in [upstream-map.md](upstream-map.md)
  and update those docs.
- Update the "Mapped against" line in [upstream-map.md](upstream-map.md) and the "Last verified"
  line in [tech-debt.md](../plans/tech-debt.md); remove tech-debt entries that upstream fixed.
- Search for Markdown links to files this fork removed (upstream's `README.md` has them); this
  should print nothing:
  ```bash
  git grep -n -E '\]\([^)]*((BUILDING|GPU_ACCELERATION|building_in_linux|LOCAL_WORKFLOW|LOGGING_OPTIMIZATIONS|NOTIFICATION_TESTING|CLEANUP_PLAN|ACCELERATION_GUIDE|WORKFLOWS_OVERVIEW|README_DEVTEST)\.md|docs/architecture\.md|frontend/API\.md)' -- '*.md'
  ```
- `git commit` to finish the merge.

**3. Test, then merge the sync branch**

```bash
cd frontend && pnpm run tauri:dev               # checks from testing.md, then the smoke test
git checkout main && git merge sync/upstream-<version>
./install_local.sh                              # run by you, not by an agent (AGENTS.md rule 9)
git checkout devtest && git merge main          # keep devtest a superset of main
```

The checks to run are in [testing.md](testing.md#which-checks-to-run).

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
