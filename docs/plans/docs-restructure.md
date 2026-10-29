# Docs Restructure for AI Agents

**Status:** In progress · Step 1 done · **Branch:** `enhance/docs-organization` · **Started:** 2026-10-29

Goal: make this repo's documentation work well for any coding agent (Codex, Cursor, Copilot,
Claude Code, Gemini, ...) and for humans, while keeping original content that still applies.

---

## Decisions

| # | Decision | Notes |
|---|---|---|
| D1 | **Option A: full restructure**, including upstream-owned docs | Upstream edits to merged/moved docs are carried over at sync time using `docs/development/upstream-map.md` (Step 11). Past-year volume: ~10–15 doc edits outside `README.md`. |
| D2 | `AGENTS.md` is the single source of agent instructions | Read natively by most agents. |
| D3 | Every `AGENTS.md` has a sibling `CLAUDE.md` containing only `@AGENTS.md` | Claude Code reliably auto-loads `CLAUDE.md`; `AGENTS.md` support is unconfirmed. No symlinks (Windows checkouts). |
| D4 | No `.gemini/` or other tool-specific config | Keep only `AGENTS.md` + `CLAUDE.md`. |
| D5 | Folder-level agent files only in `frontend/src-tauri/` and `frontend/src/` | `backend/` is covered by one rule in the root `AGENTS.md` plus `backend/README.md`. Root `AGENTS.md` names each folder file explicitly for tools that do not auto-load nested files. |
| D6 | Docs branch changes docs only | Code, tooling and script problems go to `docs/plans/tech-debt.md` and are fixed on separate branches. Docs describe current behavior. |
| D7 | Lint is excluded from agent verification until configured | See TD-01. |
| D8 | Frontend tests are documented as `npx bun@1.3.14 test` | See TD-02. |
| D9 | Integration flow: feature branches → `devtest` → `main` | Documented in `docs/LOCAL_WORKFLOW.md`. Merge this branch into `devtest` when done. |

## Writing rules for agent-facing docs

1. Plain Markdown with relative links; no tool-specific syntax in `AGENTS.md` (only `CLAUDE.md` uses `@`).
2. Root `AGENTS.md` holds only what applies to every task (~150 lines); details live in folder files and `docs/`.
3. Commands are copy-pasteable and state their working directory; every command is tested before commit.
4. Rules are stated as imperatives ("Never edit an existing migration").
5. Reference files and symbols, not line numbers.
6. Recurring changes get a checklist in `docs/development/recipes.md`.
7. Every plan starts with a status line.
8. When a change alters a command, path, rule or module layout, update the doc in the same commit.

---

## Target layout

```
AGENTS.md, CLAUDE.md
README.md, CONTRIBUTING.md, PRIVACY_POLICY.md, LICENSE.md   (stay; README links updated)
frontend/README.md                       (shrunk to a pointer)
frontend/src/AGENTS.md, CLAUDE.md
frontend/src-tauri/AGENTS.md, CLAUDE.md
frontend/src-tauri/templates/README.md   (stays next to the templates, corrected)
backend/README.md                        (stays)
docs/
├── README.md
├── architecture/   overview, audio-pipeline, transcription, summarization, data-storage
├── development/    building, testing, logging, recipes, ci-release, local-workflow, upstream-map
├── plans/          ux-improvement, speaker-diarization, tech-debt, docs-restructure (this file)
└── images/         (done)
```

## File disposition

| Current file | Action | Destination |
|---|---|---|
| `CLAUDE.md` | Content moved out; becomes `@AGENTS.md` | `AGENTS.md`, folder `AGENTS.md`s, `architecture/*` |
| `docs/architecture.md` | `git mv`, then expand | `architecture/overview.md` |
| `docs/BUILDING.md`, `docs/building_in_linux.md`, `docs/GPU_ACCELERATION.md` | Merge, delete | `development/building.md` |
| `frontend/README.md` | Setup merged; shrunk to pointer; drop false "speaker diarization" | `development/building.md` |
| `frontend/API.md`, `backend/API_DOCUMENTATION.md`, `backend/SCRIPTS_DOCUMENTATION.md` | Delete (archive stubs) | — |
| `frontend/src-tauri/CLEANUP_PLAN.md` | Delete (already folded into TD-12…TD-17) | `plans/tech-debt.md` |
| `frontend/src-tauri/LOGGING_OPTIMIZATIONS.md` | Keep usage rules, delete | `development/logging.md` |
| `frontend/src-tauri/NOTIFICATION_TESTING.md` | Merge, delete | `development/testing.md` |
| `frontend/src-tauri/templates/README.md` | Stays; list all 6 templates, fix Linux path | — |
| `.github/workflows/*.md` (3) | Merge, delete; keep Windows portability rules verbatim | `development/ci-release.md` |
| `docs/LOCAL_WORKFLOW.md` | `git mv` + sync recipe | `development/local-workflow.md` |
| `docs/UX_IMPROVEMENT_PLAN.md` | `git mv` + status | `plans/ux-improvement.md` |
| `docs/SPEAKER_DIARIZATION_PLAN.md` | Add + `git mv` + status | `plans/speaker-diarization.md` |
| `README.md`, `backend/README.md` | Stay; links updated | — |
| `CONTRIBUTING.md`, `PRIVACY_POLICY.md`, `LICENSE.md`, issue/PR templates, `backend/whisper-custom/server/README.md` | Unchanged | — |

## Steps (one commit each, reviewed before the next)

1. ✅ Verify facts (findings below; code issues in `tech-debt.md`).
2. Moves only (`git mv` of 1:1 files + link fixes), so git keeps rename detection for upstream syncs.
3. Root `AGENTS.md` + `CLAUDE.md`.
4. `frontend/src-tauri/` and `frontend/src/` `AGENTS.md` + `CLAUDE.md`.
5. `docs/architecture/*`.
6. `development/building.md`; delete merged sources; shrink `frontend/README.md`; update `README.md` links.
7. `development/ci-release.md`; delete `.github/workflows/*.md`.
8. `testing.md`, `logging.md`, `recipes.md`; delete merged sources and stubs.
9. Plans: status lines, UX plan updates (optional: convert `file:line` refs to symbols).
10. Small fixes in remaining files (`templates/README.md`, links).
11. `upstream-map.md`, sync recipe in `local-workflow.md`, `docs/README.md`, link check, cold read of `AGENTS.md`, merge to `devtest`.

---

## Step 1 findings (verified 2026-10-29)

Source of truth for Steps 3–8. Code problems found here are in [tech-debt.md](tech-debt.md).

### Repository state
- `main` contains upstream `a2cb62e` (Release v0.4.1, 2026-09-10); upstream has no newer commits.
- Cargo workspace at repo root: members `frontend/src-tauri` (package `meetily`, lib `app_lib`) and
  `llama-helper`. Shared `target/` at repo root. `rust-version = 1.77`.
- Upstream doc edit frequency (Oct 2025–Sep 2026): `README.md` 21, `WORKFLOWS_OVERVIEW.md` 5,
  `ACCELERATION_GUIDE.md` 5, `BUILDING.md` 4, `README_DEVTEST.md` 3, `building_in_linux.md` 2,
  `frontend/README.md` 2, `CLAUDE.md` 2, others 0–1.

### Verification commands
| Command (dir) | Result |
|---|---|
| `npx tsc --noEmit` (`frontend/`) | Pass |
| `pnpm run lint` (`frontend/`) | Not configured (TD-01) |
| `npx bun@1.3.14 test` (`frontend/`) | 48 pass, 11 files |
| `cargo check` (`frontend/src-tauri/`) | Pass, 8 warnings (TD-13) |
| `cargo test --lib` (`frontend/src-tauri/`) | 245 pass, 1 known failure (TD-03), 3 ignored |
| CI | Manual-only installer builds; no test/lint job (TD-04) |

### Paths
| Data | Location |
|---|---|
| App data dir | Tauri `app_data_dir()`: `com.meetily.ai` (installed), `com.meetily.ai.dev` (dev, via `tauri.dev.conf.json`) |
| Database | `<app data>/meeting_minutes.sqlite` (legacy `meeting_minutes.db` is imported if found) |
| Models | `<app data>/models/` (Whisper, Parakeet, built-in summary model) |
| Preferences | `<app data>/*.json` (`preferences.json`, `recording_preferences.json`, `onboarding-status.json`, `analytics.json`) |
| Recordings | macOS `~/Movies/meetily-recordings`, Windows `%USERPROFILE%\Music\meetily-recordings`, Linux `~/Documents/meetily-recordings` (user-configurable) |
| Custom templates | `dirs::data_dir()/Meetily/templates`: macOS `~/Library/Application Support/Meetily/templates`, Windows `%APPDATA%\Meetily\templates`, Linux `~/.local/share/Meetily/templates` (TD-14, TD-15) |
| Bundled templates | `frontend/src-tauri/templates/*.json`: `standard_meeting`, `daily_standup`, `project_sync`, `retrospective`, `sales_marketing_client_call`, `psychatric_session` |

### Audio
- macOS system audio default: **Core Audio tap** (`audio/capture/core_audio.rs`, aggregate device + tap;
  needs Audio Capture permission on macOS 14.4+). Alternative: **ScreenCaptureKit** via CPAL.
  Selected in UI (`components/AudioBackendSelector.tsx`; commands `set_audio_backend`,
  `get_audio_backend_info`; config in `audio/capture/backend_config.rs`). **BlackHole is not required.**
- `Info.plist` declares `NSMicrophoneUsageDescription`, `NSScreenCaptureUsageDescription`,
  `NSAudioCaptureUsageDescription`.
- Pipeline types confirmed in `audio/pipeline.rs`: `AudioMixerRingBuffer`, `ProfessionalAudioMixer`;
  metrics batching via `AudioMetricsBatcher` (`audio/batch_processor.rs`).
- Audio modules missing from the old `CLAUDE.md` tree: `transcription/` (`engine`, `provider`,
  `whisper_provider`, `parakeet_provider`, `worker`), `vad.rs`, `import.rs`, `retranscription.rs`,
  `incremental_saver.rs`, `device_monitor.rs`, `playback_monitor.rs`, `ffmpeg_mixer.rs`, `post_processor.rs`.
- `AUDIO_MODULARIZATION_PLAN.md` referenced by `CLAUDE.md` does not exist.

### Frontend ↔ Rust
- ~199 commands registered in `tauri::generate_handler!` in `src-tauri/src/lib.rs`; ~30 events emitted
  from Rust, ~25 listened to in the frontend. Docs should point to sources, not list them.
- Recording start from the UI: `start_recording_with_devices_and_meeting` (also `start_recording`);
  then `pause_recording`, `resume_recording`, `stop_recording`, `get_recording_state`.
- Frontend layout: `src/app` (routes), `src/components` (104 files), `src/contexts` (8: Config,
  ImportDialog, MeetingDraft, OllamaDownload, Onboarding, RecordingPostProcessing, RecordingState,
  Transcript), `src/hooks` (23), `src/services` (6: config, indexedDB, recording, storage,
  transcript, update), `src/lib`, `src/types`, `src/constants`, `src/config`.
- Notification test commands in `NOTIFICATION_TESTING.md` are all still registered.
- Logging macros exist: `perf_debug!`, `perf_trace!` (`lib.rs`), `async_info!` (`audio/async_logger.rs`).
  `RUST_LOG=app_lib::audio=debug` is the correct module filter.

### Summarization
- Providers exposed in the UI: `builtin-ai` (local, via `llama-helper` sidecar), `ollama`, `claude`,
  `groq`, `openrouter`, `openai`, `custom-openai`. Gemini is not supported (TD-16).
- Summary engine for built-in AI: `src/summary/summary_engine/` (`sidecar.rs`, `model_manager.rs`, `client.rs`).

### Build
- `pnpm tauri:dev` / `tauri:build` → `scripts/tauri-auto.js`: uses `TAURI_GPU_FEATURE` if set, else
  `scripts/auto-detect-gpu.js`; dev adds `--config src-tauri/tauri.dev.conf.json`.
- Detection: macOS Apple Silicon → `coreml`, Intel → `metal` (macOS always links Metal + CoreML via
  target-specific `whisper-rs` features). Windows/Linux: CUDA (`nvidia-smi` + `nvcc`/`CUDA_PATH`) →
  ROCm (Linux; `rocm-smi` + `hipcc`/`ROCM_PATH`) → Vulkan (`vulkaninfo` + `VULKAN_SDK` + `BLAS_INCLUDE_DIRS`)
  → OpenBLAS (`BLAS_INCLUDE_DIRS`) → CPU.
- Explicit variants: `pnpm tauri:dev:<feature>` / `tauri:build:<feature>` for
  `cpu|cuda|vulkan|metal|coreml|openblas|hipblas`.
- `dev-gpu.sh` / `build-gpu.sh` (macOS/Linux): detect GPU, build `llama-helper` with matching features,
  copy it to `src-tauri/binaries/<name>-<target-triple>`, then run `tauri:dev` / `tauri:build`
  (`build-gpu.sh` sets `NO_STRIP=true`).
- Sidecars in `externalBin`: `llama-helper` (must be built first, TD-09) and `ffmpeg` (downloaded by `build.rs`).
- Next.js: dev server on port 3118 (`beforeDevCommand: pnpm dev`); production is a static export to
  `frontend/out` (`beforeBuildCommand: pnpm build`).
- Tooling seen locally: Node 20.20, pnpm 10.33 (CI: 9.15.9), cargo 1.99.1; `bun` not installed.

### Plans
- `UX_IMPROVEMENT_PLAN.md`: items 1a and 2 shipped (`07efb86`, `47bc829`: `RecordingHeader.tsx`,
  `lib/format-duration.ts`, migration `20261028000000_add_meeting_title_user_set.sql`); item 5 shipped
  (`d4598a4`). Items 1b, 3, 4, 6, 7, 8 not started. Finding F5 is obsolete.
- `SPEAKER_DIARIZATION_PLAN.md`: proposal, no code; still uncommitted.

### Factual errors to fix while migrating content
- `CLAUDE.md`: BlackHole requirement; `Meetily/models` paths; missing `AUDIO_MODULARIZATION_PLAN.md`;
  stale "Current: fix/audio-mixing"; outdated `start_recording` example; incomplete audio tree and provider list.
- `frontend/README.md`: claims speaker diarization support.
- `GPU_ACCELERATION.md`: "edit `default = [\"cuda\"]`" (use `TAURI_GPU_FEATURE` or `tauri:dev:<feature>`);
  broken anchor `#--building-on-linux`; detection order wrong.
- `BUILDING.md` Windows: "CPU-only by default" (auto-detection runs; NVIDIA without CUDA does fall back to CPU).
- Linux guide: `TAURI_GPU_FEATURE=""` (TD-06) and `CMAKE_CUDA_ARCHITECTURES=86` example (TD-07).
- Two different "build script internals" descriptions; the one above is correct.
- `templates/README.md`: lists 2 of 6 templates; Linux path wrong.
- `.github/workflows/WORKFLOWS_OVERVIEW.md`: lists upstream-only secrets (Apple, DigiCert, Supabase
  license) as required; this fork has none.
- Issue templates ask for "Browser" (desktop app).
- `PRIVACY_POLICY.md`: `[Current Date]` placeholder; provider list incomplete (upstream policy, leave unless asked).
