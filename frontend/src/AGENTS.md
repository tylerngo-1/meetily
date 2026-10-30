# AGENTS.md — UI (`frontend/src`)

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds what applies to the Next.js UI.
Paths below are relative to `frontend/src/` unless they start with `frontend/`.
How the UI fits with the Rust core (commands, events, life of a meeting):
[architecture overview](../../docs/architecture/overview.md).

## Stack and constraints

- Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS 3, shadcn/ui, BlockNote 0.36, `sonner` toasts.
- The app is a **static export** (`output: 'export'` in `frontend/next.config.js`) loaded by Tauri.
  There is no Node server at runtime: no API routes, no server actions, no SSR data fetching, and
  routes cannot depend on runtime ids. Pass ids as query parameters (`/meeting-details?id=...`).
- Everything the app does beyond rendering goes through the Rust core via Tauri (`@tauri-apps/api`).
  `pnpm run dev` serves the UI without Tauri, so every `invoke` fails there; use `pnpm run tauri:dev`
  to test real behavior.
- Import from `src/` with the `@/` alias (`@/components/ui/button`).

## Layout

| Path | Contents |
|---|---|
| `app/` | Routes: `/` (`page.tsx`, recording screen; `_components/` holds its pieces), `/meeting-details`, `/settings`; `layout.tsx` mounts all providers |
| `contexts/` | App-wide state (table below) |
| `components/` | Feature folders (`Sidebar/`, `MeetingDetails/`, `AISummary/`, `ImportAudio/`, `onboarding/`, ...) and shadcn primitives in `ui/` |
| `hooks/` | Recording flow (`useRecordingStart`, `useRecordingStop`, `useTranscriptStreaming`, ...) and `meeting-details/` hooks (data, summary generation, templates, copy) |
| `services/` | Thin wrappers over Tauri calls: `recordingService`, `storageService`, `transcriptService`, `configService`, `updateService`, `indexedDBService` (crash recovery) |
| `lib/` | Pure helpers (formatting, analytics, summary parsing); best place for unit-tested logic |
| `types/`, `constants/`, `config/` | Shared types and constants |

## State: contexts and who owns what

| Context | Owns |
|---|---|
| `RecordingStateContext` | **Single source of truth** for recording status (`isRecording`, `isPaused`, `activeDuration`, `status`), synced from the backend. Never duplicate this state in components |
| `TranscriptContext` | Live transcript segments for the current recording, IndexedDB recovery writes |
| `MeetingDraftContext` | Metadata typed during recording (currently the title); flushed to the meeting after save |
| `ConfigContext` | Transcription/summary model settings, selected devices, preferences |
| `RecordingPostProcessingProvider` | Saving and navigation after a recording stops from any source (UI, tray) |
| `OnboardingContext`, `OllamaDownloadContext`, `ImportDialogContext` | First-run flow, Ollama model downloads, audio import dialog |
| `components/Sidebar/SidebarProvider` | Meetings list, current meeting, refetching |

Provider order in `app/layout.tsx` matters: a provider can only use contexts mounted above it.

## Do not break

| Area | Why |
|---|---|
| `hooks/useRecordingStart.ts` | Home button, sidebar auto-start (`sessionStorage.autoStartRecording`) and the `start-recording-from-sidebar` window event all converge here; model readiness checks live here |
| `hooks/useRecordingStop.ts` | Saves via `storageService.saveMeeting` → `api_save_transcript`, flushes `MeetingDraftContext`, then routes to `/meeting-details?id=...&source=recording`, which triggers the automatic summary |
| `sessionStorage` keys `last_recording_folder_path`, `last_recording_meeting_name`, `indexeddb_current_meeting_id` | Hand-off between start, stop and crash recovery |
| Meeting title at recording start | Becomes the on-disk folder name; renames after start only change the database title |

## Talking to the Rust core

- Commands: `invoke('command_name', { camelCaseArgs })` from `@tauri-apps/api/core`. Many
  components call `invoke` directly; prefer adding to an existing service when one fits.
- Events: `listen('event-name', handler)` from `@tauri-apps/api/event` returns a promise of an
  unlisten function. **Always unlisten on unmount**, and handle the case where the component
  unmounts before the promise resolves:
  ```ts
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen('recording-started', handler).then((fn) => (cancelled ? fn() : (unlisten = fn)));
    return () => { cancelled = true; unlisten?.(); };
  }, []);
  ```
- Rust command errors arrive as rejected promises with a string message: catch them and show a
  `toast.error(...)` that says what happened and what to do.

## UI conventions

- Build with the primitives in `components/ui/` (button, dialog, popover, command, select, tabs,
  sheet, tooltip, ...). Do not add new UI libraries.
- Colors: red = recording/destructive, amber = paused/warning, blue = primary, gray = chrome.
- Icon-only controls need an `aria-label`; keep focus visible; use `motion-safe:` for animations.
- Copy is sentence case ("New recording"), with no exclamation marks in status text.
- Analytics (`lib/analytics.ts` → Rust `analytics/`) is opt-in. Event properties may contain random
  ids, counts, durations, error codes and model names, never titles, transcript text, summaries or
  file paths.

## Tests

- Location: `frontend/tests/lib/*.test.ts` (pure logic) and `frontend/tests/hooks/*.test.tsx`
  (hooks, rendered with `react-test-renderer`). Framework: `bun:test`.
- Run from `frontend/`: `npx bun@1.3.14 test`, and `npx tsc --noEmit` for types.
- Bun shares `mock.module(...)` mocks across test files: save the original module and restore it in
  `afterAll` (see `tests/hooks/summary-generation.test.tsx`).
- Put new logic in `lib/` or a hook so it can be tested without Tauri.
