# Upstream Doc Map

This fork reorganized upstream's documentation (see [docs-restructure.md](../plans/docs-restructure.md)).
When an upstream sync changes one of upstream's doc files, use this map to carry the change into the
file where that content lives now. The sync steps are in
[local-workflow.md](local-workflow.md#pulling-official-updates).

**Mapped against:** upstream `a2cb62e` (v0.4.1). Update this line after each sync.

## How upstream doc changes arrive

| Our change to the upstream file | What a sync does when upstream edits it | What to do |
|---|---|---|
| **Deleted** (content moved) | Modify/delete conflict; git leaves upstream's new version in the tree | Read upstream's change (`git diff <old-upstream> upstream/main -- <file>`), apply it to the destination below, then `git rm <file>` |
| **Rewritten** (`CLAUDE.md`, `frontend/README.md`, `frontend/src-tauri/templates/README.md`) | Content conflict | Keep ours (`git checkout --ours <file> && git add <file>`), apply upstream's change to the destination below |
| **Edited in place** (`README.md`, `CONTRIBUTING.md`, the two bug-report issue templates, `backend/*.md`) | Usually merges; conflicts only where both sides changed the same lines | Accept upstream's text, then re-apply our small edits (listed below) and `git add` |
| **Unchanged** | Merges cleanly | Nothing |
| Any file, **deleted by upstream** while we kept or edited it | Delete/modify conflict | Usually accept the deletion (`git rm <file>`) after moving anything still true into our docs |

No deleted file is detected as a rename (each was merged into a larger file or rewritten), so all
of them behave as "Deleted" above. Upstream files that are new since the last sync arrive as new
files: decide whether to keep them, merge them into an existing doc, or delete them, and add a row here.

## Map

| Upstream file | Now lives in | Notes |
|---|---|---|
| `CLAUDE.md` | Root [AGENTS.md](../../AGENTS.md), [frontend/src-tauri/AGENTS.md](../../frontend/src-tauri/AGENTS.md), [frontend/src/AGENTS.md](../../frontend/src/AGENTS.md), [docs/architecture/](../architecture/) | Our `CLAUDE.md` contains only `@AGENTS.md`; never take upstream's content into it. Rules and commands → root `AGENTS.md`; Rust patterns → `src-tauri/AGENTS.md`; UI patterns → `src/AGENTS.md`; audio, transcription and summary internals → the matching `architecture/` file; "Common Development Tasks" → [recipes.md](recipes.md) |
| `docs/architecture.md` | [architecture/overview.md](../architecture/overview.md) | Expanded; diagrams and component descriptions kept |
| `docs/BUILDING.md` | [building.md](building.md) | Prerequisites → §1, scripts → §7, production builds → §6 |
| `docs/building_in_linux.md` | [building.md](building.md) | Linux packages → §1, GPU setup → §5 |
| `docs/GPU_ACCELERATION.md` | [building.md](building.md#4-how-gpu-acceleration-is-chosen) | Detection → §4, per-backend setup → §5 |
| `frontend/README.md` | [building.md](building.md) (setup, run, troubleshooting) | Ours is a short pointer; keep it that way |
| `frontend/API.md` | (deleted) | Archive note for the old whisper-server API; drop upstream edits unless they add facts about the current app |
| `frontend/src-tauri/LOGGING_OPTIMIZATIONS.md` | [logging.md](logging.md#rules) | Only the usage rules were kept; performance claims were dropped |
| `frontend/src-tauri/NOTIFICATION_TESTING.md` | [testing.md](testing.md#notification-testing-macos) | Check new commands are registered in `lib.rs` before documenting them |
| `frontend/src-tauri/CLEANUP_PLAN.md` | [tech-debt.md](../plans/tech-debt.md) (TD-12 to TD-17) | Add new items as tech-debt entries |
| `.github/workflows/ACCELERATION_GUIDE.md` | [ci-release.md](ci-release.md#windows-portability-keep-as-a-unit) | **The portability text is kept word for word**: copy upstream's new wording exactly. Platform overview → "Hardware acceleration in CI" |
| `.github/workflows/WORKFLOWS_OVERVIEW.md` | [ci-release.md](ci-release.md#workflows) | Workflow table, release process, secrets, troubleshooting. Re-check claims against the `.yml` files |
| `.github/workflows/README_DEVTEST.md` | [ci-release.md](ci-release.md#workflows) | DevTest row and notes |
| `frontend/src-tauri/templates/README.md` | Same file (rewritten) | Keep the 6-template table and loading order in sync with `templates/*.json` and `src/summary/templates/` |
| `README.md` | Same file | Ours changes only links to moved docs and images. After a sync, check that no link points to a deleted or moved file |
| Images in `docs/` (all 29 `*.png`, `*.gif`, `*.jpg`) | `docs/images/` (`architecture/`, `branding/`, `demos/`, `screenshots/`) | Moved with `git mv` (git detects all as renames), so git follows edits to existing images. New upstream images arrive in `docs/`: move them into `docs/images/` and fix the links |
| `CONTRIBUTING.md` | Same file | Ours adds a fork note at the top |
| `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/issue_template.md` | Same files | Ours replaces the "Browser" field with desktop-app environment fields |
| `backend/README.md`, `backend/API_DOCUMENTATION.md`, `backend/SCRIPTS_DOCUMENTATION.md` | Same files | Ours changes only links to moved docs |
| `PRIVACY_POLICY.md`, `LICENSE.md`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/documentation.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `backend/whisper-custom/server/README.md` | Same files | Unchanged; take upstream's version |

Fork-only docs (no upstream counterpart): `AGENTS.md` files, `docs/README.md`, `docs/architecture/*`
except `overview.md`, `docs/development/*`, `docs/plans/*`.

## Upstream code changes that make our docs stale

Upstream does not update our docs, so a sync that changes these areas needs the listed doc checked:

| Upstream changed | Re-check |
|---|---|
| `frontend/package.json` scripts, `frontend/scripts/`, `frontend/*.sh` / `*.bat` / `*.ps1`, `Cargo.toml` features | [building.md](building.md), root `AGENTS.md` (Commands) |
| `.github/workflows/*.yml`, `.github/*.cmake` / `*.cjs` | [ci-release.md](ci-release.md) |
| `frontend/src-tauri/migrations/` | [data-storage.md](../architecture/data-storage.md) (tables) |
| `audio/` | [audio-pipeline.md](../architecture/audio-pipeline.md) |
| `whisper_engine/`, `parakeet_engine/`, `audio/transcription/` | [transcription.md](../architecture/transcription.md), recipe 11 |
| `summary/`, provider folders, `templates/` | [summarization.md](../architecture/summarization.md), recipe 4, templates README |
| `lib.rs` (`generate_handler!`, plugins), `main.rs` | `src-tauri/AGENTS.md`, [logging.md](logging.md) |
| New or removed files under `src/` that match rule 3's dead-code list | Root `AGENTS.md`, rule 3; TD-12 |
| Any fixed problem listed in [tech-debt.md](../plans/tech-debt.md) | Remove or update the entry and the docs that mention it |
