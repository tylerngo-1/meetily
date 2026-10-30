# UX Improvement Plan: Recording & Meeting Organization

**Status:** In progress · Items 1a, 2, 5 shipped · **Created:** 2026-10-28 · **Updated:** 2026-10-29 · **Scope:** Items 1–8 (implement), items 9–11 (future)

| Item | Status | Where |
|---|---|---|
| 1a Recording header + live timer | ✅ Shipped | PR #1 (`07efb86`, `47bc829`) |
| 1b Real per-source audio levels | Not started | |
| 2 Editable meeting title during recording | ✅ Shipped | PR #1 (`07efb86`, `47bc829`) |
| 3 Sidebar date grouping | Not started | |
| 4 Single start entry point + idle home | Not started | |
| 5 Remove dead `/notes` route | ✅ Shipped | `f138819` (page deleted), `d4598a4` (sidebar routing) |
| 6a Meeting duration / 6b Live notes | Not started | |
| 7 Participants, tags, header, filters | Not started | |
| 8 Start sheet + meeting type | Not started | |

Line numbers in this plan were captured on 2026-10-28 and drift as code changes; locate code by the
named symbol or file instead.

This document is an implementation plan intended to be executed by engineers or AI coding agents. Each work item lists the problem, the target behavior, the exact files involved, implementation steps, and acceptance criteria. Items are ordered so each can ship as an independent PR.

---

## 0. Read This First (Guardrails for Implementers)

### 0.1 Architecture reminders

- The supported app is **Tauri (Rust) + Next.js** under `frontend/`. Do **not** touch `backend/` (archived FastAPI).
- Frontend → Rust calls use `invoke('command_name', {...})`. Rust → frontend uses events (`listen('event-name', ...)`).
- Tauri converts **camelCase JS argument keys to snake_case Rust parameters** (e.g. `{ meetingId }` → `meeting_id`). Match existing call sites when in doubt.
- New Tauri commands must be added to `tauri::generate_handler![...]` in `frontend/src-tauri/src/lib.rs`.
- SQLite migrations live in `frontend/src-tauri/migrations/` and run automatically at startup via `sqlx::migrate!("./migrations")` (`frontend/src-tauri/src/database/manager.rs:35`). **Never edit an existing migration file** — always add a new one named `YYYYMMDDHHMMSS_description.sql`. Migrations must be additive (`ALTER TABLE ... ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`).

### 0.2 Do-not-break list

These are coupling points between UI and core. Restyle around them freely, but preserve their behavior:

| Area | File | Why it's sensitive |
|---|---|---|
| Recording start (3 entry paths) | `frontend/src/hooks/useRecordingStart.ts` | Home button, sidebar auto-start (`sessionStorage.autoStartRecording`), and `start-recording-from-sidebar` window event all converge here. Model readiness checks live here. |
| Recording stop & save | `frontend/src/hooks/useRecordingStop.ts` | Reads `last_recording_folder_path` / `last_recording_meeting_name` from `sessionStorage`, calls `storageService.saveMeeting` → `api_save_transcript`, then routes to `/meeting-details?id=...&source=recording` (which triggers auto-summary). |
| Recording state | `frontend/src/contexts/RecordingStateContext.tsx` | Polls backend every 500 ms while recording; exposes `isRecording`, `isPaused`, `recordingDuration`, `activeDuration`, `status`. Single source of truth — do not duplicate this state. |
| Live transcripts | `frontend/src/contexts/TranscriptContext.tsx` | Holds `transcripts`, `meetingTitle`, IndexedDB recovery writes. |
| Audio pipeline | `frontend/src-tauri/src/audio/pipeline.rs` | Hot path. Only item 1b touches it, and only with a throttled, non-blocking emit. |
| Meeting folder name | `frontend/src-tauri/src/audio/audio_processing.rs:15` (`sanitize_filename`) | The meeting title passed at recording start becomes the on-disk folder name. |
| Meeting model queries | `frontend/src-tauri/src/database/repositories/meeting.rs` | `MeetingModel` is loaded via `sqlx::query_as` with **explicit column lists** (e.g. `get_meeting_metadata`). Adding a field to `MeetingModel` requires updating every `SELECT` that maps to it, or marking the field `#[sqlx(default)]`. |

### 0.3 Verification for every PR

```bash
cd frontend
npx tsc --noEmit                      # type-check
npx bun@1.3.14 test                   # tests in frontend/tests/ (bun is not a project dependency)
cd src-tauri && cargo check && cargo test --lib   # only if Rust changed
```

`pnpm run lint` is not usable yet (no ESLint config; see TD-01 in [tech-debt.md](tech-debt.md)).
`cargo test --lib` has one known failure, `test_builtin_mic_detection` (TD-03); any other failure is new.

Manual smoke test (required for any PR touching recording, sidebar, or meeting details):

1. Start a recording from the **home screen** and separately from the **sidebar** button.
2. Speak for ~30 s; confirm live transcript appears.
3. Pause → resume → stop.
4. Confirm the meeting appears in the sidebar, the details page opens, and the summary auto-generates.
5. Restart the app; confirm the meeting and its data persist.

### 0.4 Suggested PR sequence

| PR | Items | Rust changes? | Status |
|---|---|---|---|
| PR-1 | 5 (remove dead `/notes` route) | No | ✅ Done |
| PR-2 | 1a (recording header + timer), 2 (editable title) | No (planned) · Yes (actual: migration + summary/folder fixes) | ✅ Done (PR #1) |
| PR-3 | 4 (single start entry point + idle home state) | No | |
| PR-4 | 1b (real audio levels) | Yes — small, pipeline | |
| PR-5 | 6a (duration), 3 (sidebar date grouping) | Yes — migration + API field | |
| PR-6 | 6b (live notes pane) | Yes — 2 commands | |
| PR-7 | 7 (participants, tags, meeting header, sidebar filters) | Yes — migration + commands | |
| PR-8 | 8 (start sheet + meeting type → template) | Yes — 1 column | |

Shared foundation introduced in PR-2 and extended later: **`MeetingDraftContext`** (see §2.3) — the in-memory "meeting being recorded" metadata that is flushed to the DB after the meeting row is created.

---

## 1. Current State Summary (Audit Findings)

Status as of 2026-10-29: F1, F3 and F5 are resolved (items 1a, 2, 5). The evidence column describes
the code as audited on 2026-10-28.

| # | Finding | Evidence |
|---|---|---|
| F1 | ✅ *Resolved by item 1a.* No elapsed timer while recording | `RecordingControls.tsx:406-478` renders only pause/stop + bars in the recording branch; `duration` is hardcoded `0` (line 65) and only used in the unused playback branch |
| F2 | Level bars are random, not real audio | `app/page.tsx:172-186` sets random heights every 300 ms |
| F3 | ✅ *Resolved by item 2.* Meeting title is auto-generated, not visible or editable while recording | `useRecordingStart.ts:60` → `Meeting 27_10_26_14_03_22`; home `TranscriptPanel` header has only Copy/Language |
| F4 | Two visually different "start recording" entry points | Sidebar footer red button (`Sidebar/index.tsx:777`) vs floating mic (`RecordingControls.tsx:384`) |
| F5 | ✅ *Resolved by item 5.* Dead sample route with fake data | `app/notes/[id]/page.tsx` (hardcoded "John Doe" etc.); sidebar routes non-meeting ids to `/notes/${id}` (`Sidebar/index.tsx:581-582`) |
| F6 | Sidebar is a flat title list; no date, duration, or grouping | `SidebarProvider.tsx:100` consumes `api_get_meetings` which returns only `{id, title}` (`api.rs:30`) |
| F7 | `meeting_notes` table exists but is unused | `migrations/20251223000000_add_meeting_notes.sql`; no references in `src/` or `src-tauri/src/` |
| F8 | No participants / tags / type metadata | `meetings` table: `id, title, created_at, updated_at, folder_path` |
| F9 | Meeting details page has no meeting header (date, duration, people) | `app/meeting-details/page-content.tsx` renders only `MeetingDetailsSplitView` |
| F10 | Summary template is chosen only after the meeting, and not persisted per meeting | `hooks/meeting-details/useTemplates.ts:12` defaults to `standard_meeting` each mount |

---

## 2. Item 1 — Recording Header: Live Timer & Real Audio Levels

### 2.1 Goal

While recording, the user should always see: **meeting title (editable)**, **elapsed time**, **recording state** (Recording / Paused), and **per-source audio activity** (Mic, System) that reflects real input.

### 2.2 Target layout (home page while recording)

```
┌──────────────────────────────────────────────────────────────────┐
│ ● REC  00:12:47   [ Weekly design sync            ✎ ]            │
│        Mic ▁▃▅▃▁   System ▁▁▂▁▁            [Copy] [Language]      │
├──────────────────────────────────────────────────────────────────┤
│                     live transcript ...                          │
│                                                                  │
│                 ( ⏸ )  ( ■ )         ← existing floating controls │
└──────────────────────────────────────────────────────────────────┘
```

- When paused: dot turns amber, label "PAUSED", timer freezes (uses `activeDuration`, which excludes pauses).
- When idle (not recording): header is replaced by the idle home state from Item 4.

### 2.3 Foundation: `MeetingDraftContext` (introduced in this PR)

Create `frontend/src/contexts/MeetingDraftContext.tsx`:

```ts
export interface MeetingDraft {
  title: string;              // user-visible title, editable during recording
  generatedTitle: string;     // the title sent to backend at start (folder name source)
  participants: string[];     // Item 7
  tags: string[];             // Item 7
  templateId: string | null;  // Item 8
  agenda: string;             // Item 8
  notesMarkdown: string;      // Item 6b
  notesJson: string | null;   // Item 6b (BlockNote JSON)
}
```

- Provide `draft`, `updateDraft(partial)`, `resetDraft(initial?)`, and `flushDraftToMeeting(meetingId): Promise<void>`.
- In this PR `flushDraftToMeeting` only handles the title (see Item 2). Later items extend it.
- Persist the draft to `sessionStorage` key `meetily.meetingDraft` on every change (debounced 500 ms) so a renderer reload during recording doesn't lose it. Clear it after a successful flush.
- Mount the provider in `frontend/src/app/layout.tsx` inside the existing providers, **below** `RecordingStateProvider` and `TranscriptProvider` (it reads neither, but keep ordering consistent).

> **Implemented in PR #1 (minimal version).** What exists today, which items 6b, 7 and 8 must extend:
> - `MeetingDraft` has only `title` and `generatedTitle`. Add the other fields when their item lands.
> - The context exposes `draft`, `setDraftTitle(title)` and `flushDraftToMeeting(meetingId): Promise<string | null>`
>   (returns the saved title, or `null` if unchanged or the save failed). There is no general
>   `updateDraft`/`resetDraft` in the public API yet; add them when a second field needs editing.
> - The draft resets itself on the `recording-started` event, reading the backend name via
>   `recordingService.getRecordingMeetingName()`, so UI, sidebar and tray starts are all covered.
> - The draft is written to `sessionStorage` (`meetily.meetingDraft`) on every change (no debounce) and
>   restored after a renderer reload; `flushDraftToMeeting` clears it before saving.

### 2.4 Item 1a — Live timer (frontend only)

**Files**
- New: `frontend/src/app/_components/RecordingHeader.tsx`
- Edit: `frontend/src/app/_components/TranscriptPanel.tsx` (render `RecordingHeader` in the sticky header area when `isRecording`)
- New util: `frontend/src/lib/format-duration.ts` → `formatDuration(seconds: number): string` returning `MM:SS` under one hour, `H:MM:SS` otherwise.

**Steps**
1. Read `activeDuration` and `isPaused` from `useRecordingState()`. `activeDuration` is in seconds and is refreshed every 500 ms by existing polling — **do not add another poll**.
2. To avoid the display jumping in 0.5 s steps, interpolate locally: store `{ baseSeconds: activeDuration, baseAt: performance.now() }` whenever `activeDuration` changes; render `baseSeconds + (now - baseAt)/1000` from a `requestAnimationFrame` or 250 ms interval tick, **only while not paused**. Clamp so it never goes backwards.
3. Render status pill: red pulsing dot + "REC" when recording, amber dot + "PAUSED" when paused. Use `aria-live="polite"` on the status label only (not on the timer, to avoid screen-reader spam).
4. Use `font-variant-numeric: tabular-nums` (`tabular-nums` Tailwind class) so the timer width doesn't jitter.

> **Implemented in PR #1.** `RecordingHeader.tsx` (`useElapsedSeconds`) interpolates `activeDuration` with a
> 250 ms interval, never decreases, and freezes while paused. The status pill shows "Rec" (red, pulsing under
> `motion-safe`) or "Paused" (amber) with `aria-live="polite"`; the timer uses `tabular-nums` and `role="timer"`.
> It is rendered by `TranscriptPanel.tsx` while recording. The random level bars (F2) are unchanged until item 1b.

**Acceptance criteria**
- Timer starts at 00:00 within 1 s of recording start, increments smoothly, freezes while paused, resumes from the frozen value.
- Timer never decreases.
- No new `invoke` calls or intervals beyond the single UI tick.

### 2.5 Item 1b — Real per-source audio levels (small Rust change)

**Problem:** the existing `audio-levels` event (`audio/level_monitor.rs`, `audio/simple_level_monitor.rs`) is produced by a **separate device-monitoring stream** used by `DeviceSelection.tsx` via `start_audio_level_monitoring`. It is not emitted during recording, and **must not be started during recording** (it opens additional device streams).

**Approach:** emit a lightweight, throttled level event from the recording pipeline itself.

**Rust (`frontend/src-tauri/src/audio/pipeline.rs`)**
1. Where per-device chunks are processed (the code path that already computes `mono_data` with `device_type` available, around the normalization block near L570–600), compute `rms` and `peak` for the chunk (cheap; the code already computes RMS in debug paths).
2. Maintain a per-device "latest level" in a small struct guarded by the existing pipeline task ownership (no new locks on the hot path if avoidable; an `AtomicU32` storing `f32::to_bits` per device is acceptable).
3. Emit at most **10 Hz** an event `recording-audio-levels` with payload:
   ```rust
   #[derive(Clone, serde::Serialize)]
   pub struct RecordingAudioLevels {
       pub mic_rms: f32, pub mic_peak: f32,
       pub system_rms: f32, pub system_peak: f32,
       pub timestamp_ms: u64,
   }
   ```
   Use `app_handle.emit(...)`; on error, `perf_debug!` log and continue — never propagate errors from this path.
4. Emit nothing while paused (or emit zeros once on pause).

**Frontend**
1. New hook `frontend/src/hooks/useRecordingAudioLevels.ts`: `listen('recording-audio-levels')` while `isRecording`, unlisten on stop/unmount; expose `{ mic, system }` with smoothing (exponential decay, e.g. `level = max(new, prev * 0.85)`).
2. In `RecordingHeader`, render two compact meters labeled **Mic** and **System** (naming convention per CLAUDE.md: "microphone"/"system"). Reuse `CompactAudioLevelMeter` from `frontend/src/components/AudioLevelMeter.tsx` if it fits; otherwise a 5-bar mini meter.
3. If no level event has arrived for > 3 s while recording and not paused, show a subtle warning on that source: "No audio detected from Mic" with a link to device settings. Do **not** block recording.
4. Replace the random `barHeights` animation in `frontend/src/app/page.tsx:172-186` with mic levels from the hook (keep the `barHeights` prop shape for `RecordingControls` to minimize churn), or remove the bars from `RecordingControls` entirely now that the header shows meters. Prefer removal; update `RecordingControlsProps` accordingly.

**Acceptance criteria**
- Speaking into the mic moves the Mic meter; playing system audio moves the System meter; silence shows flat meters.
- Event rate ≤ 10/s (verify with a console counter in dev).
- No measurable change in transcription latency or dropped-chunk warnings (`RUST_LOG=app_lib::audio=debug` once TD-32 is fixed; until then only `info` and above print).
- If 1b is deferred, 1a must still ship and the random bars must at minimum be static (not animated) when paused.

---

## 3. Item 2 — Editable Meeting Title During Recording

### 3.1 Goal

The user can name the meeting at any point during recording. The default title is readable.

### 3.2 Constraints

- The title passed to the backend at start (`meetingName` in `recordingService.startRecordingWithDevices`) becomes the **folder name** on disk. Renaming mid-recording must **not** attempt to rename the folder.
- On stop, `useRecordingStop` saves using `savedMeetingName` from `sessionStorage` (backend source of truth). The rename is therefore applied **after save** via the existing `api_save_meeting_title` command (`api.rs:900`, params `meeting_id`, `title`).

> **Implemented in `enhance/recording-header` (PR #1, `07efb86`, `47bc829`).** Deviations from the steps below, which later items should build on:
> - Default title is `Meeting YYYY-MM-DD HH.MM` (folder-safe). Because it only has minute resolution, `create_meeting_folder` in `audio/audio_processing.rs` now appends `_2`, `_3`, ... when a folder with the same name already exists (covered by the `meeting_folder_tests` unit test).
> - The title editor is a local `EditableRecordingTitle` component in `RecordingHeader.tsx` (not `components/EditableTitle.tsx`): click or Enter to edit, Enter/blur to commit, Esc to cancel, 200-character limit, empty reverts.
> - `useRecordingStop` calls `flushDraftToMeeting(meetingId)` after `storageService.saveMeeting(...)` and before navigation; failures show a non-blocking toast.
> - The AI-extracted meeting name is now written before the summary process is marked completed, so a poll that sees `completed` always reads the final title.
> - The draft is reset from the `recording-started` event inside `MeetingDraftContext` (covers UI, sidebar **and tray** starts), not from the three paths in `useRecordingStart`.
> - `TranscriptContext.meetingTitle` is **not** synced with the draft; the draft is the only source for the user's title.
> - Summary generation used to overwrite the title unconditionally with the AI-extracted name (`summary/service.rs` → `update_meeting_name`). Migration `20261028000000_add_meeting_title_user_set.sql` adds `meetings.title_user_set`; `update_meeting_title` (user rename via `api_save_meeting_title`) sets it, and `update_meeting_name` (automatic) skips meetings where it is set. `useSummaryGeneration` now prefers the stored title (`pollingResult.meetingName`) over the summary's `MeetingName`. Any future rename path must pick the right repository function.

### 3.3 Steps

1. **Readable default title.** In `useRecordingStart.ts` `generateMeetingTitle` (line 60), change the format to `Meeting YYYY-MM-DD HH.MM` (e.g. `Meeting 2026-10-28 14.03`). It must contain no `/ \ : * ? " < > |` characters (folder-safe). Confirm with `sanitize_filename` in `audio_processing.rs:15` that it passes through unchanged. All three start paths in this file call `generateMeetingTitle` — no other change needed there.
2. On recording start, call `resetDraft({ title: generated, generatedTitle: generated })` (all three start paths — put this in one place, e.g. right after `setMeetingTitle(...)`).
3. In `RecordingHeader`, render an inline-editable title bound to `draft.title`. Reuse `frontend/src/components/EditableTitle.tsx` if its API fits; otherwise implement: click/Enter to edit, Enter/blur to commit, Esc to cancel, max 200 chars, trim, empty → revert to previous value.
4. Also keep `TranscriptContext.setMeetingTitle(draft.title)` in sync so existing consumers (e.g. `RecordingControls meetingName` prop) see the new name.
5. In `useRecordingStop.ts`, right after `meetingId` is obtained from `storageService.saveMeeting(...)` (line ~262) and **before** `router.push(...)`:
   ```ts
   await flushDraftToMeeting(meetingId); // swallow + toast on error; never block navigation
   ```
   `flushDraftToMeeting` calls `invoke('api_save_meeting_title', { meetingId, title: draft.title })` only if `draft.title.trim() !== draft.generatedTitle`. Then update the sidebar (`setCurrentMeeting({ id: meetingId, title: draft.title })` and `refetchMeetings()`).
6. Make sure the sidebar entry and the details page show the edited title immediately after the redirect.

### 3.4 Acceptance criteria

- Rename during recording → after stop, sidebar and details page show the new title; folder on disk keeps the original name (expected).
- Not renaming → no extra `api_save_meeting_title` call.
- Title save failure shows a non-blocking toast; meeting is still saved and navigation still occurs.
- Recovery flow (`TranscriptRecovery`) is unaffected.

---

## 4. Item 3 — Sidebar: Date Grouping & Richer Rows

### 4.1 Goal

Make the meeting list scannable after dozens of meetings.

### 4.2 Target

```
Today
  Weekly design sync                 2:03 PM · 47m
  Client call – Acme                10:30 AM · 1h 12m
Yesterday
  Standup                            9:00 AM · 14m
This week
  ...
Earlier
  ...
```

### 4.3 Backend (small, additive)

1. `frontend/src-tauri/src/api/api.rs:30` — extend `Meeting`:
   ```rust
   pub struct Meeting {
       pub id: String,
       pub title: String,
       pub created_at: String,              // RFC3339
       pub duration_seconds: Option<f64>,   // populated after Item 6a; None until then
   }
   ```
2. In `api_get_meetings` (line 322), map `created_at` from `MeetingModel.created_at` (`DateTimeUtc` wrapper → `.0.to_rfc3339()`).
3. Confirm `MeetingsRepository::get_meetings` orders by `created_at DESC`. If not, add the ordering.

### 4.4 Frontend

1. `SidebarProvider.tsx:100` — update the invoke result type to include `created_at` and `duration_seconds`; extend `CurrentMeeting` / `SidebarItem` with optional `createdAt?: string; durationSeconds?: number | null`.
2. New util `frontend/src/lib/meeting-date-groups.ts`:
   - `groupMeetingsByDate(meetings, now = new Date())` → ordered buckets: `Today`, `Yesterday`, `This week` (since Monday, locale-aware is optional), `This month`, `Earlier`. Empty buckets omitted.
   - Use local time.
   - Add unit tests in `frontend/tests/lib/meeting-date-groups.test.ts` (boundaries: midnight, Monday rollover, month rollover).
3. `Sidebar/index.tsx` `renderItem` / scrollable list (lines 554–769): render group headers (small, uppercase, `text-xs text-gray-500`, sticky within the scroll container), then rows.
4. Row design: title (single line, `truncate`, full title in `title` attribute), second line `text-xs text-gray-500`: `2:03 PM · 47m`. Omit duration if null. Keep existing hover actions (rename, delete) and the search snippet block.
5. During search, keep grouping but only show matching meetings (existing filtering logic in `filteredSidebarItems` stays authoritative).
6. Reduce sidebar chrome to give the list room:
   - Replace the full-width gray **Settings** button (line 805) with an icon button in the footer row next to the version label.
   - Keep version label but at `text-[10px]`.

### 4.5 Acceptance criteria

- Meetings grouped correctly across day/week boundaries (tests pass).
- Rows show time and (when available) duration.
- Search, rename, delete, and active-meeting highlight work as before.
- Collapsed sidebar mode unaffected.

---

## 5. Item 4 — Single Start Entry Point & Idle Home State

### 5.1 Goal

One consistent, obvious way to start a recording; the home screen is meaningful when idle.

### 5.2 Decisions

- **Primary entry point:** the home screen's idle state CTA.
- **Secondary entry point:** the sidebar footer button — keep it (users start from anywhere), but give it the **same label, icon, and behavior** ("New recording"). Both must go through the same function. The sidebar path already triggers `start-recording-from-sidebar` / `autoStartRecording` → `useRecordingStart`; the home CTA calls `handleRecordingStart`. After Item 8 both will open the start sheet first.
- **Floating control bar** (`RecordingControls`) is shown **only while recording** (pause/stop). When idle it is hidden; the idle state CTA replaces it.

### 5.3 Idle home state

New component `frontend/src/app/_components/IdleHome.tsx`, rendered by `TranscriptPanel` (or `page.tsx`) when `!isRecording && status === IDLE && transcripts.length === 0`:

```
            Ready to record
   Mic: MacBook Pro Microphone · System: BlackHole 2ch   [Change]

                 [ ● New recording ]        ⌘⇧R

   Recent
   ─ Weekly design sync      Today 2:03 PM · 47m
   ─ Client call – Acme      Today 10:30 AM · 1h 12m
   ─ Standup                 Yesterday · 14m
```

1. Device line: read `selectedDevices` from `useConfig()`; "Change" opens the existing device settings (reuse the modal used by `SettingsModals` / `showModal`, or route to `/settings` recording tab).
2. CTA calls the same start function as today's mic button (`handleRecordingStart` from `useRecordingStart`), with identical disabled/loading states (`isRecordingDisabled`, `isStartingRecording`, model validation spinner).
3. Keep `PermissionWarning` above the CTA when permissions are missing (existing logic in `TranscriptPanel.tsx:93`).
4. "Recent": the 3 most recent meetings from `useSidebar().meetings` (uses data from Item 3; if Item 3 hasn't landed, show titles only). Clicking navigates to `/meeting-details?id=...`.
5. Keyboard shortcut: `Cmd/Ctrl+Shift+R` starts recording from the home page when idle. Register with a `keydown` listener scoped to the page; ignore when focus is in an input/textarea/contenteditable.

### 5.4 Edits

- `frontend/src/app/page.tsx:217-248`: render the floating controls only when `recordingState.isRecording` (plus the existing status guards). Ensure the "Processing recording..." and stopping states still render (they are shown via `RecordingControls` and `StatusOverlays` — verify nothing disappears during STOPPING).
- `Sidebar/index.tsx:777-793`: label "New recording", same mic icon; while recording, show "Recording · 12:47" (reuse `formatDuration` + `activeDuration`) and clicking navigates to `/` instead of being disabled.
- Collapsed sidebar mic button (line 477): same behavior; tooltip "New recording".

### 5.5 Acceptance criteria

- Idle home shows CTA, devices, recent meetings; no floating bar.
- Starting from home CTA, sidebar button, collapsed sidebar button, and shortcut all produce identical recordings (same title format, same draft reset).
- While recording, sidebar button shows live elapsed time and returns the user to the recording screen.
- Stopping/processing/saving overlays still appear.

---

## 6. Item 5 — Remove Dead `/notes` Route

> **Implemented.** The page was deleted in `f138819` and the sidebar routing and `notes` icon branch were
> removed in `d4598a4`. `grep -rn "/notes" frontend/src` finds no remaining links.

### 6.1 Steps

1. Delete `frontend/src/app/notes/[id]/page.tsx` (and the `notes` folder if empty).
2. `Sidebar/index.tsx:581-582`: simplify routing to `item.id.startsWith('intro-call') ? '/' : `/meeting-details?id=${item.id}``.
3. `Sidebar/index.tsx:591-592`: remove the `item.id === 'notes'` icon branch.
4. `grep -rn "/notes" frontend/src` — remove any remaining links. Do **not** confuse with the meeting notes feature in Item 6b (that lives inside meeting details, not a route).
5. Confirm `pnpm run build` (Next static export) still succeeds — `generateStaticParams` removal must not break export.

### 6.2 Acceptance criteria

- No `/notes` route in the build output; sidebar navigation unchanged for meetings.

---

## 7. Item 6 — Meeting Duration & Live Notes

### 7.1 Item 6a — Persist duration

**Migration** `frontend/src-tauri/migrations/20261028000000_add_meeting_duration.sql`:

```sql
ALTER TABLE meetings ADD COLUMN ended_at TEXT;
ALTER TABLE meetings ADD COLUMN duration_seconds REAL;

-- Backfill from transcript audio timing where available
UPDATE meetings
SET duration_seconds = (
  SELECT MAX(t.audio_end_time) FROM transcripts t WHERE t.meeting_id = meetings.id
)
WHERE duration_seconds IS NULL;
```

**Rust**
1. `database/models.rs` `MeetingModel`: add `#[sqlx(default)] pub ended_at: Option<String>` and `#[sqlx(default)] pub duration_seconds: Option<f64>`. Then update every `SELECT ... FROM meetings` that maps to `MeetingModel` in `repositories/meeting.rs` to include the new columns (search for `query_as`).
2. `api_save_transcript` (`api.rs:930`): add optional param `duration_seconds: Option<f64>`. Pass to `TranscriptsRepository::save_transcript` and set `duration_seconds` and `ended_at = now()` on the meeting row it creates. If `None`, compute `MAX(audio_end_time)` from the saved segments.
3. Return `duration_seconds` from `api_get_meetings` (Item 3 field) and from `api_get_meeting_metadata` / `api_get_meeting`.
4. Import path (`audio/import.rs`) should also set duration if it creates meetings — check and set from the audio length if readily available; otherwise leave the fallback.

**Frontend**
1. `useRecordingStop.ts`: capture `activeDuration` from `useRecordingState()` **before** stop is processed (polling resets it to `null` on `recording-stopped`; read it via a ref updated on each render), and pass it through `storageService.saveMeeting(...)` → `invoke('api_save_transcript', { ..., durationSeconds })`. Update `storageService` signature with an optional param (don't break other callers).

**Acceptance criteria**
- New recordings store duration within ±2 s of the header timer.
- Existing meetings show a backfilled duration where transcripts have timing; others show none (no "0m").

### 7.2 Item 6b — Live notes pane (wire up `meeting_notes`)

**Goal:** Users type their own notes during the meeting next to the live transcript; notes are saved with the meeting and visible/editable afterwards.

**Key constraint:** the `meeting_notes` row is keyed by `meeting_id`, but the meeting row is only created at **stop** (`api_save_transcript`). Therefore notes are held in `MeetingDraftContext` during recording and flushed after save.

**Rust**
1. New repository `frontend/src-tauri/src/database/repositories/meeting_notes.rs` with:
   - `get_notes(pool, meeting_id) -> Option<MeetingNotes>`
   - `upsert_notes(pool, meeting_id, notes_markdown, notes_json)` using `INSERT ... ON CONFLICT(meeting_id) DO UPDATE SET notes_markdown=excluded.notes_markdown, notes_json=excluded.notes_json, updated_at=excluded.updated_at`.
   Register in `repositories/mod.rs`.
2. Commands in `api/api.rs` (follow existing patterns, `log_info!`, `Result<_, String>`):
   - `api_get_meeting_notes(meeting_id: String) -> Option<{ notes_markdown, notes_json, updated_at }>`
   - `api_save_meeting_notes(meeting_id: String, notes_markdown: String, notes_json: Option<String>)`
3. Register both in `lib.rs` `generate_handler!`.

**Frontend — during recording**
1. Home page layout while recording becomes a two-pane split: **Transcript** | **My notes**. Reuse the resizable split pattern from `components/MeetingDetails/MeetingDetailsSplitView.tsx` (extract the drag/ratio logic into a shared `useResizableSplit(storageKey, defaults)` hook rather than duplicating it). On narrow widths (<768px), use tabs like the details page.
2. New component `frontend/src/components/MeetingNotes/MeetingNotesEditor.tsx` using **BlockNote** (already a dependency; see `components/AISummary/BlockNoteSummaryView.tsx` for setup). Props: `initialJson`, `initialMarkdown`, `onChange(markdown, json)`, `placeholder="Type notes… they'll be saved with this meeting"`.
3. On change, `updateDraft({ notesMarkdown, notesJson })` (debounced 500 ms). Also write to IndexedDB through `indexedDBService` alongside transcripts so notes survive a crash and appear in `TranscriptRecovery` (add a `notes` field to the recoverable meeting record; recovery should call `api_save_meeting_notes` after recovering the meeting).
4. Extend `flushDraftToMeeting(meetingId)` to call `api_save_meeting_notes` when `notesMarkdown.trim()` is non-empty.

**Frontend — after recording (meeting details)**
1. Add a third tab/pane **Notes** to `MeetingDetailsSplitView` (`TABS` array at line 11). Desktop layout recommendation: keep the transcript | summary split; render Notes as a tab **within the left pane** (Transcript / Notes) to avoid a 3-column layout. Mobile: three tabs.
2. Load via `api_get_meeting_notes` on mount (new hook `hooks/meeting-details/useMeetingNotes.ts`), autosave via `api_save_meeting_notes` debounced 1 s, show "Saved" / "Saving…" indicator.
3. Include notes in the **Copy** output for the summary as a "My notes" section (`hooks/meeting-details/useCopyOperations.ts`), only if non-empty.

**Optional (flag behind a TODO, separate PR):** pass `notes_markdown` into the summary prompt as "Attendee notes (prioritize these topics)" in `src-tauri/src/summary/`. Requires prompt review; do not bundle with UI work.

**Acceptance criteria**
- Notes typed during recording are present on the details page after stop.
- Notes survive app crash mid-recording (via recovery).
- Editing notes on the details page persists across app restarts.
- Meetings without notes show an empty editor with placeholder, no errors.

---

## 8. Item 7 — Participants, Tags, Meeting Header, Sidebar Filters

### 8.1 Data model

**Migration** `frontend/src-tauri/migrations/20261028000100_add_people_and_tags.sql`:

```sql
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL UNIQUE,  -- lower(trim(name)), used for de-dup
    email TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_participants (
    meeting_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    PRIMARY KEY (meeting_id, person_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_tags (
    meeting_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (meeting_id, tag_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_person ON meeting_participants(person_id);
CREATE INDEX IF NOT EXISTS idx_meeting_tags_tag ON meeting_tags(tag_id);
```

Notes:
- Verify foreign keys are enabled on the pool (`PRAGMA foreign_keys = ON`) — if not, `delete_meeting` in `repositories/meeting.rs` must explicitly delete join rows. Check existing behavior for `meeting_notes` and match it.
- IDs: use the same ID generation pattern as existing repositories (e.g. `uuid`).

### 8.2 Rust

New repository `repositories/people_tags.rs` (or two files) with:

- `list_people(pool) -> Vec<Person>` ordered by most-recently used (join on meeting_participants → meetings.created_at), for autocomplete.
- `set_meeting_participants(pool, meeting_id, names: Vec<String>)` — in a transaction: upsert each person by `name_normalized`, replace the meeting's participant set.
- `get_meeting_participants(pool, meeting_id) -> Vec<Person>`
- Same three for tags: `list_tags`, `set_meeting_tags`, `get_meeting_tags`.

Commands (register in `lib.rs`):

| Command | Args | Returns |
|---|---|---|
| `api_list_people` | — | `Vec<{id, name}>` |
| `api_list_tags` | — | `Vec<{id, name}>` |
| `api_get_meeting_metadata_extended` | `meeting_id` | `{ participants: Vec<{id,name}>, tags: Vec<{id,name}>, template_id: Option<String> }` |
| `api_set_meeting_participants` | `meeting_id`, `names: Vec<String>` | `Vec<{id,name}>` |
| `api_set_meeting_tags` | `meeting_id`, `names: Vec<String>` | `Vec<{id,name}>` |

Extend `api_get_meetings` `Meeting` struct with `participants: Vec<String>` and `tags: Vec<String>` (names only), fetched with **one** aggregated query per list (e.g. `GROUP_CONCAT` or two bulk queries keyed by meeting_id) — **no N+1 queries**.

Validation: trim names, drop empties, cap at 50 participants / 20 tags per meeting, cap name length at 100 chars. Return `Err(String)` with a user-friendly message on violations.

### 8.3 Frontend — shared components

1. `frontend/src/components/MeetingMetadata/ChipInput.tsx`: generic token input.
   - Type + Enter/comma/Tab to add; Backspace on empty input removes the last chip; click × to remove.
   - Autocomplete dropdown from a `suggestions: string[]` prop (case-insensitive prefix match, then contains), keyboard navigable (↑/↓/Enter/Esc). Build on the existing `components/ui/command.tsx` (cmdk) + popover.
   - De-duplicate case-insensitively.
   - Accessible: `role="combobox"`, `aria-expanded`, chips are buttons with `aria-label="Remove {name}"`.
2. `frontend/src/components/MeetingMetadata/ParticipantChips.tsx` (avatar initials + name; color derived deterministically from the name hash) and `TagChips.tsx`.

### 8.4 Frontend — during recording

- In `RecordingHeader` (Item 1), add a second row: `👥 Add participants` and `# Add tags` chip inputs bound to `draft.participants` / `draft.tags`. Collapsed by default to a single "+ Add details" affordance if the header gets crowded.
- Extend `flushDraftToMeeting` to call `api_set_meeting_participants` and `api_set_meeting_tags` when non-empty.
- Suggestions from `api_list_people` / `api_list_tags`, fetched once when the header mounts.

### 8.5 Frontend — meeting details header

New component `frontend/src/components/MeetingDetails/MeetingHeader.tsx`, rendered at the top of `app/meeting-details/page-content.tsx` above `MeetingDetailsSplitView`:

```
Weekly design sync  ✎
Tue, 28 Oct 2026 · 2:03 PM · 47m · Standard meeting
👥 [AL] Alice  [BK] Bob  [+]        # design  # q4  [+]
```

- Title: inline editable; saving calls `api_save_meeting_title` and refreshes the sidebar. Coordinate with the existing title editing inside the summary (`AISummary/index.tsx` uses `EditableTitle`) — both must read/write the **same** `meetingData.meetingTitle` / `updateMeetingTitle` from `useMeetingData` so they never diverge.
- Date/time from `meeting.created_at`; duration from Item 6a; type from Item 8 (`template_id` → template name via `useTemplates().availableTemplates`).
- Participants and tags editable via `ChipInput`; save on each change (optimistic update, rollback + toast on error).
- New hook `hooks/meeting-details/useMeetingMetadata.ts` to load (`api_get_meeting_metadata_extended`) and save.
- Header must stay compact (≤ 2 lines at 1280px wide) and wrap gracefully on narrow windows.

### 8.6 Frontend — sidebar filters

1. Above the grouped list (Item 3), add a filter row: `[Person ▾] [Tag ▾]` popovers with multi-select (cmdk list from `api_list_people` / `api_list_tags`). Active filters shown as removable chips; "Clear" link.
2. Filtering is client-side over `meetings` (which now include `participants` and `tags` names). Combine with search: a meeting must match search **and** all active filters (AND across filter types, OR within a type).
3. Persist active filters in `localStorage` key `meetily.sidebar.filters` (try/catch).
4. Row second line may show up to 2 participant initials avatars after the time/duration.

### 8.7 Acceptance criteria

- Participants/tags entered during recording are saved with the meeting.
- Editing on the details page persists across restart; sidebar reflects changes after `refetchMeetings()`.
- Autocomplete suggests previously used names; "alice" and "Alice" resolve to one person.
- Deleting a meeting removes its join rows (no orphan `meeting_participants` / `meeting_tags`).
- Sidebar filters work with search; `api_get_meetings` latency with 500 meetings stays < 100 ms (no N+1).

---

## 9. Item 8 — Start Sheet & Meeting Type → Summary Template

### 9.1 Goal

Before recording begins, optionally capture title, participants, meeting type, and agenda — without slowing down users who just want to hit record.

### 9.2 Data

**Migration** `frontend/src-tauri/migrations/20261028000200_add_meeting_template.sql`:

```sql
ALTER TABLE meetings ADD COLUMN template_id TEXT;
```

- Add `#[sqlx(default)] pub template_id: Option<String>` to `MeetingModel`, update SELECTs (see §0.2).
- Command `api_set_meeting_template(meeting_id: String, template_id: Option<String>)`; include `template_id` in `api_get_meeting_metadata_extended`.
- Templates come from `api_list_templates` (JSON files in `frontend/src-tauri/templates/`: `standard_meeting`, `daily_standup`, `project_sync`, `retrospective`, `sales_marketing_client_call`, `psychatric_session`). Use the template's display name from the API, never hardcode names.

### 9.3 Start sheet UI

New component `frontend/src/components/StartRecordingSheet.tsx` (use `components/ui/dialog.tsx`):

```
┌ New recording ───────────────────────────────┐
│ Title        [ Meeting 2026-10-28 14.03     ] │
│ Type         [ Standard meeting          ▾ ] │
│ Participants [ Alice × Bob × | type…        ] │
│ Agenda       [                              ] │
│              [                              ] │
│                                               │
│ ☐ Don't show this again                       │
│                     [Cancel]  [● Start  ⏎]    │
└───────────────────────────────────────────────┘
```

- **Start** is the default button; `Cmd/Ctrl+Enter` starts from anywhere in the sheet; plain Enter in single-line fields starts too. Focus lands on **Title** with text pre-selected so typing replaces it.
- All fields optional. Title pre-filled with `generateMeetingTitle()`; type pre-filled with the last used template (`localStorage` `meetily.lastTemplateId`, fallback `standard_meeting`).
- **Title must be folder-safe** (see §3.2). Either sanitize on input (replace forbidden chars with `-`) or pass the sanitized title as the backend `meetingName` and keep the raw title in `draft.title` (then the post-save rename in Item 2 applies it). Prefer the second: send `generatedTitle` (or sanitized user title) to backend, keep display title in draft.
- "Don't show this again" → `PreferenceSettings.tsx` gets a toggle **"Show meeting details before recording"** (default **on**). Store with the existing preferences mechanism used in that component.
- Agenda: stored in draft; on flush it is written as the initial content of meeting notes (`## Agenda\n...`) if notes are empty, and also visible in the notes pane during recording (prepend once at start).

### 9.4 Flow integration

1. All start entry points (home CTA, sidebar button, collapsed sidebar button, shortcut) open the sheet **if** the preference is on and the start is user-initiated. Implement by introducing a single `requestStartRecording()` in a small `useStartRecordingFlow` hook / context that either opens the sheet or calls through directly.
2. Non-interactive starts (tray menu, `start-recording-from-sidebar` event dispatched programmatically, auto-start after navigation via `sessionStorage.autoStartRecording`) — the sheet's submit should set the draft **then** trigger the existing path. Make sure the sidebar auto-start path (navigates to `/` then starts) does not open the sheet twice: open the sheet in the sidebar, then navigate + auto-start with the draft already populated.
3. On submit: `resetDraft({ title, generatedTitle: backendSafeTitle, participants, templateId, agenda, ... })`, then call the existing start function. **The model-readiness checks in `useRecordingStart` remain authoritative** — if they fail, the existing modal flow still runs; the draft is kept so the user doesn't retype.
4. Extend `flushDraftToMeeting` to call `api_set_meeting_template` when `templateId` is set and store `meetily.lastTemplateId`.

### 9.5 Template usage after recording

1. `hooks/meeting-details/useTemplates.ts`: accept an optional `initialTemplateId` (from `useMeetingMetadata`) and initialize `selectedTemplate` from it instead of always `standard_meeting`.
2. When the user changes the template on the details page (`handleTemplateSelection`), also persist via `api_set_meeting_template`.
3. **Auto-generated summary after recording must use the meeting's template.** In `page-content.tsx` the auto-generate effect (line ~161) currently fires once model config settles; add a condition that metadata (template) has loaded before triggering, so the first summary uses the chosen type. Do not change the auto-generate trigger semantics otherwise (`source=recording`).
4. Show the type in the meeting header (Item 7) and allow changing it there (same persistence).

### 9.6 Acceptance criteria

- With the preference on, every user-initiated start shows the sheet; Enter immediately starts with defaults (≤ 1 extra keystroke vs today).
- With the preference off, behavior is identical to Item 4.
- Selected type is persisted and used for the auto-generated summary.
- Agenda appears in notes during and after the meeting.
- If model is not ready, the existing model-setup modal appears and the draft is preserved.

---

## 10. Design System Notes (apply across all items)

- Reuse existing primitives in `frontend/src/components/ui/` (shadcn: `button`, `dialog`, `command`, `select`, `tabs`, `dropdown-menu`, `input-group`). Don't add new UI libraries.
- Color semantics: red = recording/destructive, amber = paused/warning, blue = primary/selection, gray = chrome. Existing code uses Tailwind `gray-*`/`blue-*` — stay consistent.
- Typography: section labels `text-xs font-medium uppercase tracking-wide text-gray-500`; row titles `text-sm`; meta `text-xs text-gray-500`; timers `tabular-nums`.
- All interactive elements must be keyboard reachable with visible focus (`focus-visible:ring-2 ring-blue-500`), have `aria-label`s when icon-only, and meet WCAG AA contrast.
- Respect `prefers-reduced-motion` for pulsing dots and meter animations (`motion-safe:` Tailwind variant).
- User-facing copy: sentence case ("New recording", "Add participants"), no exclamation marks in status text, errors say what happened and what to do.

---

## 11. Future Considerations (Not in Scope)

### 11.1 Item 9 — Structured action items

- Table `action_items(id, meeting_id, text, owner_person_id NULL, due_date NULL, done INTEGER, source_transcript_id NULL, source_time REAL NULL, created_at, updated_at)`.
- Populate by parsing the "Action Items" section of the generated summary (structured JSON output from the LLM is preferable to parsing markdown; requires summary prompt/schema changes in `src-tauri/src/summary/`).
- UI: checkboxes inside the summary that persist, owner picker from participants (Item 7), and a global **"Open action items"** view in the sidebar across meetings.
- Open question: two-way sync between BlockNote summary content and the `action_items` table — decide which is the source of truth before building.

### 11.2 Item 10 — Speaker renaming / mapping to participants

- `transcripts.speaker` currently stores `mic` / `system` (migration `20251110000001_add_speaker_field.sql`). Short term: display "You" / "Others" labels in transcript views (`VirtualizedTranscriptView.tsx`).
- Longer term: diarization of the system channel into `speaker_1..n`, then a per-meeting mapping table `meeting_speakers(meeting_id, speaker_key, person_id)` so users can click a speaker label and assign a participant. Summary prompts can then attribute statements and action items to people.

### 11.3 Item 11 — Calendar import

- Local-first: read macOS Calendar (EventKit) / ICS files; no cloud account required, consistent with the privacy positioning.
- On "New recording", if a calendar event overlaps now (±10 min), pre-fill the start sheet title, participants, and agenda (event description).
- Requires a new macOS permission prompt and a settings toggle; Windows/Linux via ICS import only at first.

### 11.4 Other ideas captured during review

- **In-meeting markers:** one-click ⭐ Highlight / ✅ Action / ❓ Question buttons in the recording header that tag the current transcript segment (new `transcript_markers` table); feed into summary and Item 9.
- **Audio-synced transcript:** clicking a transcript timestamp plays the recording from that point (audio files exist in `meeting.folder_path`).
- **Meeting status:** `recorded → summarized → reviewed` with a "Needs review" filter.
- **Empty summary state:** when no model is configured, the CTA should open model settings directly instead of only saying "select a model in Settings" (`components/EmptyStateSummary.tsx`).

---

## 12. Appendix — Key File Index

| Purpose | Path (under `frontend/`) |
|---|---|
| Home page | `src/app/page.tsx` |
| Home transcript panel | `src/app/_components/TranscriptPanel.tsx` |
| Recording controls (floating bar) | `src/components/RecordingControls.tsx` |
| Start / stop hooks | `src/hooks/useRecordingStart.ts`, `src/hooks/useRecordingStop.ts` |
| Recording state | `src/contexts/RecordingStateContext.tsx` |
| Transcript state | `src/contexts/TranscriptContext.tsx` |
| Sidebar UI / state | `src/components/Sidebar/index.tsx`, `src/components/Sidebar/SidebarProvider.tsx` |
| Meeting details | `src/app/meeting-details/page.tsx`, `src/app/meeting-details/page-content.tsx` |
| Details split view | `src/components/MeetingDetails/MeetingDetailsSplitView.tsx` |
| Summary panel | `src/components/MeetingDetails/SummaryPanel.tsx`, `src/components/AISummary/` |
| Templates hook | `src/hooks/meeting-details/useTemplates.ts` |
| Audio level meter | `src/components/AudioLevelMeter.tsx` |
| Preferences | `src/components/PreferenceSettings.tsx` |
| Tauri commands (meetings) | `src-tauri/src/api/api.rs` |
| Command registration | `src-tauri/src/lib.rs` |
| DB models / repositories | `src-tauri/src/database/models.rs`, `src-tauri/src/database/repositories/` |
| Migrations | `src-tauri/migrations/` |
| Audio pipeline | `src-tauri/src/audio/pipeline.rs` |
| Folder name sanitization | `src-tauri/src/audio/audio_processing.rs` |
| Summary templates | `src-tauri/templates/*.json` |
| Frontend tests | `tests/` (run with `bun test`) |
