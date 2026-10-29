# AGENTS.md — Rust core (`frontend/src-tauri`)

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds what applies to the Rust core.
Paths below are relative to `frontend/src-tauri/`.

## Module map (`src/`)

| Module | Responsibility |
|---|---|
| `lib.rs` | App setup, plugin and state registration (`.manage(...)`), **command registration** (`generate_handler!`), `perf_debug!`/`perf_trace!` macros |
| `audio/` | Device discovery (`devices/`), capture (`capture/`: microphone, system, macOS Core Audio tap), mixing and VAD (`pipeline.rs`, `vad.rs`), recording lifecycle (`recording_manager.rs`, `recording_commands.rs`, `recording_state.rs`, `recording_saver.rs`, `incremental_saver.rs`), transcription workers (`transcription/`), import and re-transcription (`import.rs`, `retranscription.rs`), device monitoring |
| `whisper_engine/` | Whisper model management and inference (`whisper-rs`) |
| `parakeet_engine/` | Parakeet (NVIDIA NeMo, ONNX) model management and inference |
| `summary/` | Summary generation (`service.rs`, `processor.rs`, `llm_client.rs`), templates (`templates/`), built-in local LLM via the `llama-helper` sidecar (`summary_engine/`) |
| `anthropic/`, `groq/`, `ollama/`, `openai/`, `openrouter/` | LLM provider clients |
| `database/` | SQLite pool (`manager.rs`), models (`models.rs`), repositories (`repositories/`: meeting, transcript, transcript_chunk, summary, setting) |
| `api/` | Meeting, transcript and settings commands used by the UI (`api.rs`) |
| `notifications/` | System notifications and their settings |
| `analytics/` | Opt-in PostHog analytics |
| `tray.rs`, `onboarding.rs`, `config.rs`, `state.rs`, `utils.rs` | Tray menu, first-run state, constants, `AppState` (holds the `DatabaseManager`), helpers |

Dead files are listed in the root `AGENTS.md` (rule 3). Search results inside them are irrelevant.
`src/audio/devices/platform/{windows,linux}.rs` are live; they only compile on their platform.

## Adding a Tauri command

1. Write an `async fn` with `#[tauri::command]` in the module that owns the feature. Return
   `Result<T, String>` (the convention for commands); use `anyhow::Result` inside and convert with
   `.map_err(|e| e.to_string())` at the boundary.
2. Get the database through `state: tauri::State<'_, AppState>` → `state.db_manager.pool()`, and
   do SQL in a repository under `database/repositories/`, not in the command.
3. Register it in `tauri::generate_handler![...]` in `src/lib.rs`. An unregistered command fails
   at runtime with "command not found", not at compile time.
4. Call it from the UI with camelCase argument keys (`{ meetingId }` → `meeting_id`).

## Events (Rust → UI)

- Event names are kebab-case: `recording-started`, `transcript-update`, `transcription-progress`,
  `model-download-progress`, ... Search `.emit("` to see them all; check the UI listener
  (`listen('...')` in `frontend/src`) before renaming or changing a payload.
- Emit with `app.emit("name", payload)` (payload must be `Serialize + Clone`).
- In audio and transcription paths, log and ignore emit errors; never propagate them.

## Database

- Pool setup and `sqlx::migrate!("./migrations")` run in `database/manager.rs` at startup.
- Migration rules are in the root `AGENTS.md` (rule 2). Name new files
  `migrations/YYYYMMDDHHMMSS_description.sql` with a timestamp later than every existing one.
- **sqlx column trap:** several queries map rows with an explicit column list, e.g.
  `query_as("SELECT id, title, created_at, updated_at, folder_path FROM meetings WHERE id = ?")`.
  If you add a field to a model such as `MeetingModel`, update every such `SELECT`, or mark the
  field `#[sqlx(default)]`; otherwise those queries fail at runtime.
- Meeting titles: user renames go through `update_meeting_title` (sets `meetings.title_user_set`);
  automatic names from summaries go through `update_meeting_name`, which skips user-set titles.
  Pick the right one for any new rename path.

## Logging

- Use the `log` crate (`log::info!`, ...; `api.rs` aliases them as `log_info!` etc.). No `println!`.
- In hot paths (audio callbacks, pipeline, transcription loops) use `perf_debug!` / `perf_trace!`
  (compiled out in release) or the non-blocking `async_debug!`/`async_info!`/`async_warn!`
  (`audio/async_logger.rs`). Aggregate per-chunk metrics with `AudioMetricsBatcher`
  (`audio/batch_processor.rs`) instead of logging every chunk.
- Do not add logs that contain transcript text, audio content or API keys at `info` or above
  (logs end up in bug reports). Some existing code still logs transcript text (TD-18).

## Config files

| File | Purpose |
|---|---|
| `tauri.conf.json` | Main config. Plugin permissions are inline under `app.security.capabilities` (one capability, `main`; there is no `capabilities/` folder). Using a new plugin API from the UI requires adding its permission there |
| `tauri.dev.conf.json` | Dev override: app identifier `com.meetily.ai.dev` |
| `tauri.local.conf.json` | **Fork-only** override used by `install_local.sh`: disables updater artifacts and points the updater at this fork's releases. Keep it in sync when changing updater or bundle settings |
| `Info.plist`, `entitlements.plist` | macOS permission strings (microphone, screen capture, audio capture) and entitlements. A feature that needs a new macOS permission must add its usage string here |
| `Cargo.toml` | GPU features (`metal`, `coreml`, `cuda`, `vulkan`, `hipblas`, `openblas`); macOS always links Metal + CoreML |

## Platform-specific code

Code behind `#[cfg(target_os = "windows")]` / `"linux"` (e.g. `audio/devices/platform/`) is **not
compiled by `cargo check` on macOS**. Keep such changes small, mirror the existing patterns, and say
in your report that they were not compiled. Windows and Linux builds only run in the manual GitHub
workflows.

## Concurrency

- Shared state across async tasks: `Arc<RwLock<T>>` or `Mutex`; simple flags: `AtomicBool`
  (see `audio/recording_state.rs`).
- Do not hold a lock across an `.await` in audio or transcription paths.

## Checks

Run from this directory:

```bash
cargo check
cargo test --lib        # one known failure: test_builtin_mic_detection (TD-03)
```

Unit tests live in `#[cfg(test)] mod tests` blocks inside each source file. Use `tempfile` for
filesystem tests (see `meeting_folder_tests` in `audio/audio_processing.rs`).
`cargo check` currently reports 8 warnings (TD-13); do not add new ones.
