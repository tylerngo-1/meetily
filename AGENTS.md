# AGENTS.md

Instructions for AI coding agents and humans working in this repository. Read this file first.
It covers what applies to every task; topic details live in the files listed under
[Where to read more](#where-to-read-more).

## What this is

**Meetily** is a privacy-first desktop meeting assistant: it records microphone and system audio,
transcribes locally (Whisper or Parakeet), and summarizes with a local or user-chosen LLM.
This repository is a **fork** of [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily)
that is synced from upstream regularly.

The supported app is a single **Tauri 2** application: a **Next.js 14 / React 18** UI and a **Rust** core.
There is no separate server. Releases ship for macOS (Apple Silicon) and Windows; Linux is built from source.
This fork is developed on macOS and also used daily on the same machine (see [local workflow](docs/development/local-workflow.md)).

## Repository map

| Path | What it is |
|---|---|
| `frontend/src/` | Next.js UI (TypeScript). Pages in `app/`, state in `contexts/`, logic in `hooks/` and `services/` |
| `frontend/src-tauri/` | Rust core: audio capture, transcription, database, summaries, Tauri commands (`src/lib.rs`) |
| `frontend/src-tauri/migrations/` | SQLite migrations, applied automatically at app startup |
| `frontend/src-tauri/templates/` | Built-in summary templates (JSON) |
| `frontend/tests/` | Frontend unit tests (`bun:test`) |
| `llama-helper/` | Sidecar binary for the built-in local LLM (Cargo workspace member) |
| `docs/` | Architecture, development guides, plans |
| `backend/` | **Archived** legacy Python/FastAPI backend. Never modify, run, or use it as a reference |
| `.github/workflows/` | Manually triggered build and release workflows (upstream's signing setup) |

The Cargo workspace root is the repository root (members: `frontend/src-tauri`, `llama-helper`);
build output goes to `./target/`. The Rust library crate is named `app_lib`.

## Commands

Use pnpm `9.15.9` (the version CI uses). Run frontend commands from `frontend/`.

```bash
cd frontend
pnpm install --frozen-lockfile   # install; never update pnpm-lock.yaml unless changing dependencies
pnpm run tauri:dev               # full app in dev mode (GPU auto-detected, dev app identifier)
pnpm run tauri:build             # production build
pnpm run dev                     # Next.js UI only, http://localhost:3118; every Tauri call fails here
```

- **First run on a fresh clone:** the `llama-helper` sidecar must exist in
  `frontend/src-tauri/binaries/` (gitignored), otherwise the Rust build fails with
  "`binaries/llama-helper-<target>` does not exist". On macOS/Linux run `./dev-gpu.sh` (Windows: `dev-gpu.bat`) from
  `frontend/` once; it builds the sidecar and starts the app. Otherwise, from the repo root:
  `cargo build -p llama-helper --release && cp target/release/llama-helper "frontend/src-tauri/binaries/llama-helper-$(rustc -vV | sed -n 's/host: //p')"`
  (add `--features metal` on macOS for GPU inference; add `.exe` to both names on Windows).
  The first Rust build also downloads `ffmpeg` (`build.rs`), so it needs network access.
- **GPU:** `TAURI_GPU_FEATURE=<feature> pnpm run tauri:dev` forces a backend; `none` forces CPU.
  Explicit scripts also exist: `pnpm run tauri:dev:<feature>` for `cpu|metal|coreml|cuda|vulkan|hipblas|openblas`.
- **Logs:** `RUST_LOG=debug pnpm run tauri:dev`, or scope it: `RUST_LOG=app_lib::audio=debug`.
- Dev builds use the app identifier `com.meetily.ai.dev` and their own data folder, so they never
  touch the installed app's data.

## Rules

1. **Do not touch `backend/`.** It is archived upstream code kept for historical reference; the app
   never runs it. Implement everything in `frontend/src-tauri` (Rust) and `frontend/src` (UI).
   (Importing an old `meeting_minutes.db` from a legacy install is handled in Rust, in `database/commands.rs`.)
2. **Never edit, rename or delete an existing migration** in `frontend/src-tauri/migrations/`.
   Add a new file named `YYYYMMDDHHMMSS_description.sql`, keep it additive
   (`ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`). Migrations cannot be undone by the app, and an app
   that does not know a recorded migration refuses to start.
3. **Do not edit dead code.** These files are not compiled, so changes there have no effect:
   `src/lib_old_complex.rs`, `src/audio_v2/`, `src/audio/core-old.rs`, `src/audio/recording_saver_old.rs`,
   `src/audio/recording_commands.rs.backup`, `src/audio/stt.rs`, `src/audio/system_audio_stream.rs`,
   `src/audio/system_audio_types.ts`, `src/whisper_engine/_stderr_suppressor.rs` (all under `frontend/src-tauri/`).
4. **New Tauri commands** must be registered in `tauri::generate_handler![...]` in
   `frontend/src-tauri/src/lib.rs`. Frontend `invoke` arguments are camelCase; Tauri maps them to
   snake_case Rust parameters.
5. **Audio naming:** say "microphone" and "system" for the two sources, never "input"/"output".
6. **No blocking work or per-chunk logging in the audio hot path** (`audio/pipeline.rs`, capture,
   transcription workers). Use `perf_debug!`/`perf_trace!` (compiled out in release builds).
7. **Use Tauri path APIs** (`app_data_dir()` etc.) for file locations; never hardcode paths.
8. **Privacy first.** Do not add network calls that send audio, transcripts, summaries or meeting
   metadata anywhere except the LLM provider the user selected. Analytics is opt-in and must never
   include meeting content.
9. **Protect the daily app.** Never run `frontend/install_local.sh`, quit or modify
   `/Applications/meetily.app`, or touch its data (`~/Library/Application Support/com.meetily.ai/`,
   `~/Movies/meetily-recordings/`) unless explicitly asked. Dev builds use `com.meetily.ai.dev`.
10. **Do not document or build on features that do not exist.** For example, Gemini has a database
    column but no provider, and speaker diarization is only a plan.
11. **Problems you find but do not fix** go into [docs/plans/tech-debt.md](docs/plans/tech-debt.md).

## Before you change code in these areas

- `frontend/src-tauri/` → read [frontend/src-tauri/AGENTS.md](frontend/src-tauri/AGENTS.md) first.
- `frontend/src/` → read [frontend/src/AGENTS.md](frontend/src/AGENTS.md) first.
- `.github/workflows/` → read the CI and release guide first (currently `.github/workflows/ACCELERATION_GUIDE.md`);
  Windows portability settings there must be kept as a unit.

## Verify before you finish

Run what applies and report the results honestly, including failures:

```bash
cd frontend
npx tsc --noEmit                         # always, for any frontend change
npx bun@1.3.14 test                      # always, for any frontend change
cd src-tauri
cargo check                              # any Rust change
cargo test --lib                         # any Rust change
```

- `cargo test --lib` has **one known failure**: `audio::device_detection::tests::test_builtin_mic_detection`
  (TD-03). Any other failure is new.
- `pnpm run lint` is **not usable** (no ESLint config; it opens an interactive prompt). Do not run it.
- There is no CI for tests; these local checks are the only safety net.
- For changes to recording, the sidebar or meeting details, also run the manual smoke test:
  start a recording from the home screen and from the sidebar, speak ~30 s and confirm the live
  transcript, pause → resume → stop, confirm the meeting opens and its summary generates, restart
  the app and confirm the meeting persists.

## Git workflow

- Branch from `main`: `enhance/<name>`, `fix/<name>`, `docs/<name>`, `chore/<name>`; upstream syncs use `sync/upstream-<version>`.
- Merge finished work into `devtest` for combined testing; `devtest` is promoted to `main`.
  Never commit directly to `main` or `devtest`. Details: [docs/development/local-workflow.md](docs/development/local-workflow.md).
- Commit messages use `<type>(<scope>): <subject>` with types `feat`, `fix`, `docs`, `refactor`,
  `test`, `chore`, `style`, plus a body explaining why.
- **Never mention AI agents or tools in commit messages or PR descriptions**: no `Co-Authored-By`
  or session trailers, no "generated with" lines, no tool names. Call agent instruction files
  "agent instructions".
- Commit or push only when asked.

## Where to read more

| Topic | Read |
|---|---|
| System architecture | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Audio capture, mixing, VAD, recording files | [docs/architecture/audio-pipeline.md](docs/architecture/audio-pipeline.md) |
| Transcription engines, models, import/re-transcription | [docs/architecture/transcription.md](docs/architecture/transcription.md) |
| Summary providers, templates, built-in AI | [docs/architecture/summarization.md](docs/architecture/summarization.md) |
| Data locations, database tables, migrations, legacy import | [docs/architecture/data-storage.md](docs/architecture/data-storage.md) |
| Building from source, GPU acceleration, build scripts | [docs/development/building.md](docs/development/building.md) |
| Daily-use vs dev app, installing, rollback, upstream sync | [docs/development/local-workflow.md](docs/development/local-workflow.md) |
| Logging rules | [frontend/src-tauri/LOGGING_OPTIMIZATIONS.md](frontend/src-tauri/LOGGING_OPTIMIZATIONS.md) |
| Notification testing | [frontend/src-tauri/NOTIFICATION_TESTING.md](frontend/src-tauri/NOTIFICATION_TESTING.md) |
| Summary templates | [frontend/src-tauri/templates/README.md](frontend/src-tauri/templates/README.md) |
| CI and release workflows | [.github/workflows/WORKFLOWS_OVERVIEW.md](.github/workflows/WORKFLOWS_OVERVIEW.md) |
| Known problems | [docs/plans/tech-debt.md](docs/plans/tech-debt.md) |
| Plans (check status lines before implementing) | [docs/plans/](docs/plans/) |

Docs are being restructured (see [docs/plans/docs-restructure.md](docs/plans/docs-restructure.md));
some files above will move. Known inaccuracies in the older guides are listed in that plan's
"Factual errors" section, and this file takes precedence where they disagree.

## Keep docs current

When a change alters a command, path, rule, migration convention or module layout, update the doc
that describes it in the same commit. If you cannot, add an entry to `docs/plans/tech-debt.md`.
