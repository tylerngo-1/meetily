# Tech Debt

**Status:** Living list · **Last verified:** 2026-10-29 against `main` at upstream v0.4.1 (`a2cb62e`) plus fork commits

This file lists known problems in code, tooling and build scripts. These are not doc problems: the
docs describe how things work today, and this file records what should change. Fix each item on
its own `fix/*` or `chore/*` branch, and remove it from this list in the same commit.

Each item has an ID so commits and plans can refer to it (for example `fixes TD-03`).
Severity: **High** = misleads contributors or can break a build or install. **Medium** = wastes time
or hides bugs. **Low** = cleanup.

---

## Tooling and verification

### TD-01 · `pnpm run lint` is not configured · High
- **Evidence:** No ESLint config exists in `frontend/`. `next lint` starts the interactive
  "How would you like to configure ESLint?" prompt and exits with code 1.
- **Impact:** Nothing lints the frontend. An agent or script that runs `pnpm run lint` hangs or fails.
- **Fix:** Add `frontend/.eslintrc.json` (e.g. `next/core-web-vitals`), fix or suppress the
  initial findings, then add lint to the verification steps in `AGENTS.md`.

### TD-02 · Frontend tests need `bun`, which is not declared anywhere · Medium
- **Evidence:** All 11 files in `frontend/tests/` import `bun:test`. `package.json` has no `test`
  script and does not list `bun`. Only `@types/bun` (1.3.14) is a dev dependency.
- **Impact:** `pnpm test` does not exist, and tests fail on machines without `bun`.
- **Current workaround:** `npx bun@1.3.14 test` from `frontend/` (48 tests pass).
- **Fix:** Add `"test": "bun test"` and document installing `bun`, or move to a runner that
  installs via pnpm.

### TD-03 · One Rust unit test fails · Medium
- **Evidence:** `cargo test --lib` → 245 passed, 1 failed, 3 ignored.
  `audio::device_detection::tests::test_builtin_mic_detection` expects
  `InputDeviceKind::Unknown` for "MacBook Pro Microphone" but gets `Wired`.
  The file has not changed since upstream v0.1.1.
- **Impact:** A red test suite hides new failures.
- **Fix:** Decide which behavior is right (the detector or the test) and align them. Report upstream.

### TD-04 · No automated checks in CI · Medium
- **Evidence:** All workflows in `.github/workflows/` are `workflow_dispatch` only and build
  installers. None runs `tsc`, tests, lint or `cargo test`.
- **Impact:** Local verification is the only safety net.
- **Fix:** Add a lightweight PR workflow: `tsc --noEmit`, `bun test`, `cargo check`, `cargo test --lib`.

### TD-05 · pnpm version is not pinned · Low
- **Evidence:** CI pins pnpm `9.15.9` (`pnpm/action-setup`); docs say `9.15.9`; `package.json`
  has no `packageManager` field, so local machines use whatever is installed (10.x seen locally).
- **Fix:** Add `"packageManager": "pnpm@9.15.9"` (or upgrade CI and docs together).

---

## Build scripts

### TD-06 · `TAURI_GPU_FEATURE=""` does not force CPU · High
- **Evidence:** `dev-gpu.sh` / `build-gpu.sh` run auto-detection when the variable is empty
  (`-z` check), and `scripts/tauri-auto.js` treats an empty value as "not set".
  Only `TAURI_GPU_FEATURE=none` forces CPU.
- **Impact:** The documented "force CPU-only" command silently auto-detects instead.
- **Fix:** Treat empty as CPU, or keep `none` and correct every doc that says `""`.

### TD-07 · `CMAKE_CUDA_ARCHITECTURES` is always overwritten with `75` on Linux · High
- **Evidence:** `dev-gpu.sh` and `build-gpu.sh` `export CMAKE_CUDA_ARCHITECTURES=75`
  unconditionally on Linux; `scripts/tauri-auto.js` also sets `75` for Linux + CUDA.
- **Impact:** The documented `CMAKE_CUDA_ARCHITECTURES=86 ./build-gpu.sh` has no effect, so CUDA
  builds target compute capability 7.5 regardless of the GPU.
- **Fix:** Only set defaults when the variable is unset (`: "${CMAKE_CUDA_ARCHITECTURES:=75}"`,
  and `env.X ??= '75'` in JS).

### TD-08 · NVIDIA GPU without CUDA toolkit skips Vulkan · Low
- **Evidence:** `scripts/auto-detect-gpu.js` returns CPU as soon as `nvidia-smi` exists without
  `nvcc`/`CUDA_PATH`, before checking Vulkan.
- **Fix:** Fall through to the Vulkan check instead of returning.

### TD-09 · `llama-helper` sidecar is not built by the default dev/build path · High
- **Evidence:** `tauri.conf.json` lists `binaries/llama-helper` in `externalBin`.
  `src-tauri/binaries/` is gitignored. Only `dev-gpu.sh`/`.bat`, `build-gpu.sh`/`.bat` and CI build the helper;
  `pnpm tauri:dev`, `clean_run.sh` and `install_local.sh` do not. (`ffmpeg` is fetched by `build.rs`.)
- **Impact:** A fresh clone cannot run `pnpm tauri:dev` until the helper is built once.
  `install_local.sh` bundles whatever helper binary is already in `binaries/`, which can be stale.
- **Fix:** Build the helper in `scripts/tauri-auto.js` (or a `beforeDevCommand` step) when it is
  missing or older than `llama-helper/src`, and in `install_local.sh`.

### TD-10 · `clean_run.sh` and `clean_build.sh` can modify the lockfile · Low
- **Evidence:** Both run `pnpm install` without `--frozen-lockfile`, unlike the documented install.
- **Fix:** Use `pnpm install --frozen-lockfile`.

### TD-11 · GPU build scripts are duplicated for Unix and Windows · Low
- **Evidence:** `dev-gpu.sh`/`build-gpu.sh` (macOS/Linux) and `dev-gpu.bat`/`build-gpu.bat` (Windows)
  repeat the same detect → build sidecar → copy → run Tauri logic, and `scripts/tauri-auto.js`
  repeats the CUDA flags. (An earlier version of this entry said Windows had no GPU scripts; it does.)
- **Impact:** Fixes must be made in several places (TD-06, TD-07 and TD-26 affect more than one script).
- **Fix:** Move the sidecar build into a Node script shared by all platforms (see TD-09).

### TD-25 · Stale build scripts and paths · Low
- **Evidence:** `clean_build.sh` deletes `src-tauri/target` and `package-app.sh` deletes
  `src-tauri/target/release` and points to `src-tauri/target/release/bundle`, but build output is in
  `target/` at the repository root (Cargo workspace). `build_backup.bat` and `package-app.sh` are not
  called by any script or workflow. None of `clean_*` or `build.bat` build the `llama-helper` sidecar (TD-09).
  `llama-helper/Cargo.toml` has a `[profile.release]` section (LTO, `opt-level = "s"`) that Cargo
  ignores, because profiles are only read from the workspace root `Cargo.toml`.
- **Fix:** Correct the paths; delete `build_backup.bat` and `package-app.sh` if nobody uses them;
  move the `llama-helper` profile to the root as `[profile.release.package.llama-helper]` or delete it.

### TD-26 · Sidecar build fails when ROCm or OpenBLAS is detected · High
- **Evidence:** `dev-gpu.sh`/`build-gpu.sh` pass the Whisper feature to `cargo build` for
  `llama-helper`, mapping only `coreml` → `metal`; `dev-gpu.bat`/`build-gpu.bat` pass it unchanged.
  `llama-helper/Cargo.toml` defines only `metal`, `cuda` and `vulkan`, so `hipblas` (Linux + ROCm) or
  `openblas` (`BLAS_INCLUDE_DIRS` set, no GPU) makes the build fail.
- **Impact:** The recommended first-run script fails on AMD/ROCm Linux machines and OpenBLAS setups.
- **Fix:** Map `hipblas` and `openblas` to no sidecar feature (or to `vulkan` where available).

### TD-27 · `[patch.crates-io]` in `frontend/src-tauri/Cargo.toml` is ignored · Medium
- **Evidence:** It pins `cpal` to git rev `51c3b43` and `esaxx-rs` to the `feat/dynamic-msvc-link`
  branch, but Cargo reads patches only from the workspace root (`cargo metadata` warns "patch for
  the non root package will be ignored"). `Cargo.lock` resolves both from crates.io
  (`cpal 0.15.3`, `esaxx-rs 0.1.10`). Ignored since the workspace was introduced (v0.2.0).
- **Impact:** Whatever the patches were meant to fix (audio capture, Windows MSVC linking) is not in
  the build. The current builds work, so the patches may no longer be needed, but nobody has decided that.
- **Fix:** Decide per patch: move it to the root `Cargo.toml` (changes `Cargo.lock`, needs audio
  testing on all platforms) or delete it. Upstream has the same issue.

---

## Rust core (`frontend/src-tauri`)

### TD-12 · ~8,000 lines of dead code in `src/` · Medium
These files are not compiled (verified against the compiler's dependency file for `app_lib`):

| Path | Lines |
|---|---|
| `src/lib_old_complex.rs` | 2437 |
| `src/audio/recording_commands.rs.backup` | 2068 |
| `src/audio/core-old.rs` | 923 |
| `src/audio/recording_saver_old.rs` | 404 |
| `src/audio/stt.rs` | 399 |
| `src/audio/system_audio_stream.rs` | 231 |
| `src/audio/system_audio_types.ts` | 54 |
| `src/whisper_engine/_stderr_suppressor.rs` | 82 |
| `src/audio_v2/` (9 files) | ~1,400 |

`src/audio/devices/platform/{windows,linux}.rs` are **not** dead; they compile on their platforms.

- **Impact:** Agents and grep results land in code that never runs; edits there have no effect.
- **Fix:** Delete in one commit (history keeps them). Coordinate upstream to avoid
  modify/delete conflicts on sync.

### TD-13 · Compiler warnings · Low
- **Evidence:** `cargo check` reports 8 warnings, e.g. unused `has_windows_vulkan_loader`,
  `get_builtin_templates`, unread fields `recording_sender` and `state`.
- **Fix:** Remove or use them; then consider `#![deny(warnings)]` in CI (TD-04).

### TD-14 · Custom template path comment is wrong on Linux · Low
- **Evidence:** `src/summary/templates/loader.rs` documents `~/.config/Meetily/templates/` for
  Linux, but the code uses `dirs::data_dir()`, which is `~/.local/share` (or `$XDG_DATA_HOME`).
- **Fix:** Correct the comment (docs are corrected in the restructure).

### TD-15 · Custom templates and notification settings live outside the app data folder · Low
- **Evidence:** Custom templates use `dirs::data_dir()/Meetily/templates` and notification settings
  use `dirs::config_dir()/meetily/notifications.json` (`src/notifications/settings.rs`), while the
  database, models and preferences use Tauri's `app_data_dir()` (`com.meetily.ai` / `com.meetily.ai.dev`).
- **Impact:** Dev and daily builds share custom templates and notification settings; backups made
  by `install_local.sh` do not include them.
- **Fix:** Decide whether templates should move under `app_data_dir()` (needs a migration path
  for existing files).

### TD-16 · Gemini is half-wired · Low
- **Evidence:** Migration `20251229000000_add_gemini_api_key.sql` adds a column, but there is no
  provider module and `ConfigContext.tsx` notes "Gemini omitted for now".
- **Fix:** Finish the provider or leave as is; do not document Gemini as supported.

### TD-17 · Smaller code-quality items (carried over from the old `CLEANUP_PLAN.md`) · Low
- `pub use ...::*` wildcard re-exports in 7 compiled files blur module boundaries.
- `println!`/`dbg!` remain in ~8 compiled files (e.g. `audio/vad.rs`, `audio/import.rs`,
  `analytics/analytics.rs`); some may be in tests. Hot-path logging should use `perf_debug!`.
- Very large files: `parakeet_engine/parakeet_engine.rs` (2016 lines),
  `whisper_engine/whisper_engine.rs` (1806), `audio/recording_commands.rs` (1697),
  `api/api.rs` (1383), `audio/import.rs` (1323).
- The old plan's "20+ TODOs" were almost all in the dead `audio_v2/`; only 4 TODO/FIXME remain
  in compiled code.

### TD-18 · Transcript text is logged at `info` level · Low
- **Evidence:** `whisper_engine/whisper_engine.rs` logs `Transcription #N result: '...'` and
  `Cleaned repetitive transcription ...`; `audio/transcription/worker.rs` logs
  `Worker N transcription result: text='...'`. All at `info`, which stays enabled in release builds
  (`log::set_max_level(LevelFilter::Info)` in `lib.rs`).
- **Impact:** Logs go to stderr only (`env_logger`; `tauri-plugin-log` is a dependency but never
  initialized, so no log file is written). Meeting content therefore shows up in terminal output,
  the Windows debug console (`toggle_console`), and any output users paste into bug reports.
- **Fix:** Move these lines to `perf_debug!` (compiled out in release), or log only text length and
  segment counts. Decide separately whether to wire up `tauri-plugin-log` or remove the dependency.

### TD-19 · Leftover HTTP client for the archived backend in `api/api.rs` · Low
- **Evidence:** `APP_SERVER_URL = "http://localhost:5167"` and `make_api_request` are never called;
  18 commands (e.g. `api_save_meeting_title`) still take `auth_token: Option<String>`, which the UI
  never sends and the code only logs.
- **Fix:** Remove the helper, the constant and the `auth_token` parameters.

### TD-20 · Whisper "parallel processor" is registered but unused · Low
- **Evidence:** `whisper_engine/parallel_processor.rs` and `parallel_commands.rs` register 11 commands
  (`initialize_parallel_processor`, `start_parallel_processing`, ...) and `ParallelProcessorState` is
  managed in `lib.rs`, but nothing in `frontend/src` calls any of them.
- **Impact:** Dead feature surface that looks supported (the old `CLAUDE.md` advertised it).
- **Fix:** Remove it, or wire it into batch import if it is wanted.

### TD-21 · Stale comments in the audio mixer · Low
- **Evidence:** `audio/pipeline.rs`: `AudioMixerRingBuffer` comments say 50 ms windows, the code uses
  600 ms; `ProfessionalAudioMixer::mix_window` comments say system audio is pre-scaled to 70 %, the
  code multiplies by `1.0` and leaves `_mic_scaled` unused.
- **Fix:** Update the comments to match the code (or the code to match the intent, after listening tests).

### TD-22 · `meeting_notes` and `licensing` tables are unused · Low
- **Evidence:** `migrations/20251223000000_add_meeting_notes.sql` creates `meeting_notes` and
  `migrations/20251105120000_add_pro_license_custom_openai.sql` creates `licensing`; no live Rust or
  UI code reads or writes either. UX plan item 6b intends to use `meeting_notes`.
- **Fix:** Implement item 6b; leave `licensing` as is (do not drop tables; migrations are permanent).

### TD-23 · UI listens for `chunk-drop-warning`, which is never emitted · Low
- **Evidence:** `hooks/useModalState.ts` and `services/recordingService.ts` subscribe to
  `chunk-drop-warning`; the only emitter is the dead `lib_old_complex.rs`.
- **Impact:** Audio buffer overflows are never surfaced to the user.
- **Fix:** Emit it from the live pipeline when chunks are dropped, or remove the listener.

### TD-24 · LLM API keys are stored in plain text · Medium
- **Evidence:** Provider keys (`openaiApiKey`, `anthropicApiKey`, `groqApiKey`, `openRouterApiKey`,
  and the custom OpenAI key inside the `customOpenAIConfig` JSON column) are stored in the SQLite `settings` table in `meeting_minutes.sqlite`.
  No OS keychain is used.
- **Impact:** Anyone or anything that can read the app data folder (backups, sync tools, malware)
  gets the keys. `install_local.sh` backups also contain them.
- **Fix:** Move keys to the OS keychain (e.g. the `keyring` crate) with a migration that copies and
  then clears the columns.
