# Meeting Prep and Live Notes: Spec

**Status:** In progress. P0–P4 and P6 are implemented on `enhance/meeting-notes`, P5 in part (§9) · **Created:** 2026-11-14 ·
**Updated:** 2026-11-15 (live notes redesigned as one free-form page, §4.3 and §6) · **Scope:** home prep
panel, live notes with bookmarks, notes after the meeting, summary integration, meeting series

This spec replaces three items of [ux-improvement.md](ux-improvement.md):

| ux-improvement item | What happens to it |
|---|---|
| 4 Single start entry point + idle home | Replaced by §5 (home prep panel). The entry-point unification in its §5.2 still applies. |
| 6b Live notes pane | Replaced by §6 and §7. Notes stay one plain BlockNote document; only bookmarks carry a recording time. |
| 8 Start sheet + meeting type | Replaced by §5. The dialog becomes an inline panel on home; its data rules (§9.2, §9.5) are reused. |
| 11.4 "In-meeting markers" idea | Replaced by bookmarks (§6.3), anchored to audio time instead of a transcript segment id. |

Item 7 (participants and tags) is still a separate item. This spec only needs its `people` and
`meeting_participants` tables (§4.2), which can land earlier on their own.

Code is referenced by file and symbol. Read §0 of [ux-improvement.md](ux-improvement.md) first: its
guardrails, do-not-break list and verification rules apply to every PR here.

---

## 1. Problem

1. **Home has no way to prepare a meeting.** When idle, home shows an empty transcript panel titled
   "+ New Call" (`TranscriptContext.tsx`) and a record button. Title, meeting type, participants and
   agenda can only be set after the meeting, if at all.
2. **There is no way to take notes while recording.** The user can only watch the transcript. The
   `meeting_notes` table exists but nothing uses it.
3. **The summary cannot know what mattered to the user.** It sees only the transcript, so it weighs
   every sentence the same.

## 2. Design principles

1. **Never block recording.** Every prep field is optional. `⌘R` and the record button always start
   immediately, with whatever has been filled in. Every field stays editable during and after the meeting.
2. **Notes are just notes; bookmarks have a time.** People go back and add to earlier points, so
   the moment a line was typed says little about what it refers to. When a moment matters, the user
   says so with a bookmark, which is anchored to the recording and linked to the transcript and audio.
3. **Anchor to audio time, never to transcript rows.** Re-transcription deletes every transcript row
   and inserts new ones with new ids and different boundaries
   (`audio/retranscription.rs`, `run_retranscription`). Anything keyed by a transcript id is lost.
   Audio time does not change, so notes survive any number of re-transcriptions.
4. **Every field is used.** A prep field is only worth asking for if it improves the result (see §5.2).
5. **The least effort that still captures intent.** Notes are typed like in any notes app; a bookmark is
   one keystroke. Sorting notes into actions, decisions and questions is the summary's job, not the
   user's.
6. **Nothing to learn.** No commands, tags or modes in the notes page. Markdown shortcuts (`# `, `- `,
   `[] `) work because people already know them, but nothing depends on them.

## 3. User journey

```
Home (prep, optional) ──⌘R──▶ Recording (transcript | notes) ──Stop──▶ Meeting details
  title, type, people,          free-form notes page, each           notes page with times linked
  agenda, context, series       ⌘B bookmark with a time;             to transcript and audio;
                                agenda becomes checklist blocks      summary uses notes and type
                                                                            │
Next meeting in the series ◀──────── open action items carried over ────────┘
```

---

## 4. Data model

### 4.1 The time anchor

`offset_ms` is a position in the **recording timeline**: the same clock as
`transcripts.audio_start_time` / `audio_end_time` (seconds from recording start, see
`TranscriptUpdate.audio_start_time` in `audio/transcription/worker.rs`), stored in milliseconds.

**P0 result (done):** the clock is pause-free everywhere.

- While paused, `RecordingState::send_audio_chunk` drops audio before it reaches the pipeline, so the
  saved file, VAD timestamps and re-transcription all skip paused time.
- The offset is the number of mixed samples the pipeline has produced
  (`RecordingState::record_mixed_samples`, called in `audio/pipeline.rs` after mixing) divided by the
  sample rate. That count is the position in the saved file, so notes, live transcripts, the audio
  file and re-transcribed transcripts share one clock. The counter resets in `start_recording` and
  `cleanup` (tests: `recording_clock_tests` in `recording_state.rs`).
- A wall-clock timer minus pauses was rejected: it drifts from the audio when capture stalls or
  buffers.

The frontend never computes `offset_ms` from its own timer. It asks the core (§4.4,
`api_get_recording_offset`), so notes and transcripts cannot drift apart.

### 4.2 Migrations

One migration, `frontend/src-tauri/migrations/<YYYYMMDDHHMMSS>_add_meeting_prep_and_note_entries.sql`
(timestamp = when you write it, after the newest file in `migrations/`):

```sql
CREATE TABLE IF NOT EXISTS meeting_note_entries (
    id          TEXT PRIMARY KEY,
    meeting_id  TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('note', 'bookmark', 'agenda')),
    tag         TEXT CHECK (tag IS NULL OR tag IN ('action', 'decision', 'question')),
    text        TEXT NOT NULL DEFAULT '',
    start_ms    INTEGER,          -- NULL: written outside recording time
    end_ms      INTEGER,
    quoted_text TEXT,             -- transcript text under the anchor when the entry was created
    done        INTEGER NOT NULL DEFAULT 0,  -- agenda item checked / action item completed
    position    INTEGER NOT NULL, -- display order within the meeting
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_note_entries_meeting ON meeting_note_entries(meeting_id, position);

ALTER TABLE meetings ADD COLUMN template_id  TEXT;  -- meeting type, see ux-improvement §9.2
ALTER TABLE meetings ADD COLUMN prep_context TEXT;  -- "Context for AI" field
ALTER TABLE meetings ADD COLUMN series_id    TEXT;  -- §8

-- people + meeting_participants: copy from ux-improvement §8.1 unchanged
-- (tags + meeting_tags can stay in item 7).
```

As implemented (`20261114120000_add_meeting_prep_and_note_entries.sql`):
- `MeetingModel` is **not** changed. The prep columns are read and written only by
  `MeetingPrepRepository` (`database/repositories/meeting_prep.rs`), so no existing `query_as`
  `SELECT` had to change.
- The live notes page is stored in the existing `meeting_notes` table (`meeting_id` primary key,
  `notes_markdown`, `notes_json`), through `MeetingNotesRepository`
  (`database/repositories/meeting_notes.rs`, upsert, 5 MB limit). No new migration was needed for it.
- `meeting_note_entries` exists but no UI writes it since the redesign (§4.3). It is kept for agenda
  and open actions (§5, §8) until P3 decides whether those also live in the notes document; if they
  do, drop the table in a later migration (never edit this one).
- `delete_meeting` in `repositories/meeting.rs` deletes `meeting_note_entries`,
  `meeting_participants` and `meeting_notes` rows explicitly, because `ON DELETE CASCADE` is not relied
  on.

### 4.3 Bookmark times

Notes are one document (BlockNote blocks: paragraphs, headings, lists, checklists) of plain text.
Only bookmark blocks have a time, kept next to the blocks, not inside them:

```ts
// lib/notes-document.ts
interface BlockTime { atMs: number; kind: 'bookmark'; quotedText?: string }
interface NotesDocument { version: 1; blocks: Block[]; times: Record<blockId, BlockTime> }
```

| Created by | `atMs` | Range used for the transcript |
|---|---|---|
| `⌘B` or the bookmark button | recording offset when the key is pressed | `[atMs − 8000, atMs + 2000]` |

Rules:
- Ordinary lines never get a time. Two earlier designs timed notes (one time per entry, then one per
  line) and both failed in use: a time on every line made the page feel like a log, and it was wrong
  whenever the user went back to add to an earlier point.
- A bookmark's time is set once and never moves; editing the bookmark line keeps it.
- Times of deleted blocks are dropped when the document is saved (`pruneBlockTimes`). Times of plain
  lines stored by the earlier build are dropped when a document is read (`normalizeNotesDocument`).
- A bookmark block starts with `🔖 ` (`BOOKMARK_PREFIX`) so it reads as a bookmark in the markdown
  export too. `quotedText` is the transcript text under its range at the moment it was created,
  capped at 500 characters; it records what the user heard and is never overwritten.
- The constants live in `lib/note-anchors.ts` and are tuned after use.

`notes_json` stores the whole `NotesDocument`; `notes_markdown` stores
`blocksToMarkdownLossy(blocks)` for search, export and the summary prompt.

### 4.4 Rust

Repositories: `note_entries.rs` (list, replace in one transaction, upsert, delete),
`meeting_prep.rs` (prep columns, participants, people) and `meeting_notes.rs` (notes page).

Commands in `api/notes.rs` (the clock command is in `audio/recording_commands.rs`), registered in
`lib.rs` `generate_handler!`:

| Command | Args | Returns |
|---|---|---|
| `api_get_recording_offset` | none | `Option<u64>` ms on the recording clock; `None` when not recording |
| `api_list_note_entries` | `meeting_id` | `Vec<NoteEntry>` |
| `api_save_note_entries` | `meeting_id`, `entries` | `()` (replace all; flush after stop) |
| `api_upsert_note_entry` | `entry` | `NoteEntry` |
| `api_delete_note_entry` | `id` | `()` |
| `api_get_meeting_prep` / `api_set_meeting_prep` | `meeting_id`, `template_id?`, `prep_context?`, `series_id?` | prep / `()` |
| `api_set_meeting_participants` | `meeting_id`, `names` | participants |
| `api_list_people` | none | `Vec<Person>` |
| `api_get_meeting_notes` | `meeting_id` | `Option<MeetingNotes>` |
| `api_save_meeting_notes` | `meeting_id`, `notes_markdown`, `notes_json?` | `()` (upsert) |

Validation: text ≤ 5000 chars per entry, ≤ 1000 entries per meeting, `prep_context` ≤ 20 000 chars,
`end_ms ≥ start_ms` when both are set, notes page ≤ 5 MB. Errors return a user-readable `String`.

**Required test (done):** create a meeting with transcripts and entries, run the re-transcription save
path (delete + insert of transcripts), assert every entry is unchanged. Notes need no such test: the
`meeting_notes` row is never touched by re-transcription, and its times are audio times.

### 4.5 Draft lifecycle (frontend)

The meeting row is created only at stop (`api_save_transcript`), so prep fields and entries live in
`MeetingDraftContext` until then, as ux-improvement §2.3 already does for the title.

`MeetingDraft` (`lib/meeting-draft.ts`) has: `title`, `generatedTitle`, `templateId`,
`participants`, `prepContext`, `seriesId`, `entries`, `notes: NotesDocument`, `notesMarkdown`,
`phase: 'prep' | 'recording'`, `recoveryMeetingId`, `updatedAt`.

Changes to the current context:
1. **Persistence moves from `sessionStorage` to IndexedDB** (`indexedDBService`, DB version 2, store
   `meetingDrafts`). Keys: `current` (the live draft), `recovery:<meetingId>` (draft of a recording
   that ended without being saved), `unsaved:<meetingId>` (parts that failed to save). The notes page
   writes to the draft debounced 400 ms.
2. **`recording-started` merges, not resets** (`draftOnRecordingStarted`): prep from home is kept and
   only `generatedTitle` is set from the backend meeting name. A draft still in `recording` phase from
   an earlier, unsaved recording is not carried over.
3. **Flush after save:** `flushDraftToMeeting(meetingId)` (`services/meetingDraftSync.ts`) saves the
   title, prep, participants, entries and notes page independently. A failure in one does not stop the
   others; failures are listed in one toast, and only the failed parts are kept under `unsaved:` and
   retried at startup for 7 days.
4. **Crash recovery:** at startup, the draft of a recording that is no longer running is parked under
   `recovery:<id>`. `useTranscriptRecovery` saves it with the recovered meeting, or deletes it when
   the user discards that recovery.
5. **Clear** the draft after a successful flush, so home shows an empty prep panel again.

---

## 5. Home: prep panel

### 5.1 Layout (as built)

Replaces the "Welcome to meetily!" idle state of the home page (`MeetingPrepPanel`, shown by
`TranscriptPanel` through `idleContent` when nothing is recorded or being saved).

```
┌──────────────────────────────────────────────────────┐
│ Untitled meeting                                      │
│ Everything here is optional. Press ⌘R or the record   │
│ button to start.                                      │
│                                                       │
│ Type     [Standard meeting      ▾]                    │
│ People   (An ×) (Bình ×) Add                          │
│ ───────────────────────────────────────────────────── │
│ Notes                                                 │
│ Agenda, questions, anything. This page stays open     │
│ while you record.                                     │
│ [] Review last sprint                                 │
│ [] Scope PDF export                                   │
│                    ● record controls (existing)       │
└──────────────────────────────────────────────────────┘
```

- `PermissionWarning` stays above the form when permissions are missing (existing behavior); without
  microphone permission the form is not shown.
- While recording, the form is replaced by the recording view (§6). After stop and save, home shows
  an empty form again.

### 5.2 Fields

| Field | Default | Used by |
|---|---|---|
| Title | Empty, placeholder "Untitled meeting"; the generated `Meeting YYYY-MM-DD HH.MM` name is used when left empty | Meeting title (draft `title`, saved by the flush) |
| Type | Last used (`localStorage` `meetily.lastTemplateId`), else "Standard meeting" | Summary template: saved as `meetings.template_id`; the details page loads it (`useTemplates(meetingId)`), auto-generation waits for it, and changing the template there saves it back |
| People | Empty; Enter or comma adds a name, Backspace removes the last; suggestions from `people` (`api_list_people`) | Summary prompt (§7.3); later speaker mapping |
| Notes | Empty | The **same** notes page that continues while recording (§6): an agenda is just checklist lines (`[] `). Given to the summary with everything else written there |

Decisions taken while building it, to keep the form small:
- **No separate agenda field.** Agenda items are checklist lines in the notes page, so there is one
  place to write and nothing to convert. This answers open question 7: `meeting_note_entries` is not
  needed for the agenda.
- **No "Context for AI" field.** Background written in the notes page reaches the summary the same
  way; a second free-text box would raise "which one do I use?". `meetings.prep_context` stays in the
  schema and is still sent to the summary if set.
- **Not built yet:** devices line with mic meter (needs ux-improvement 1b), saved setups, recent
  meetings, series (§8).

### 5.3 Behavior

- `⌘R` starts recording from anywhere on home, including from inside a field, through the same
  `start-recording-from-sidebar` event as the sidebar button, so model checks and errors are the
  same. It is off while recording, stopping or saving.
- The sidebar "New recording" button starts immediately and carries the current draft.
- Model-readiness checks in `useRecordingStart` stay authoritative. If they fail, the existing modal
  runs and the draft is kept.
- Focus: nothing is focused on load.
- Notes typed on home are written to the draft only while it is in the `prep` phase; once recording
  starts, the recording's notes pane owns the document.

### 5.4 Acceptance criteria

- With every field empty, one press of `⌘R` starts recording (no extra step compared with today).
- Prep typed on home survives an app restart before recording starts.
- Prep typed on home is saved with the meeting after stop, and type is used for the
  auto-generated summary.
- Notes typed on home are on the notes page when recording starts.
- Starting from home, sidebar, collapsed sidebar and shortcut produce the same meeting data.

---

## 6. Recording: live notes

### 6.1 Layout

```
┌ ● Sprint planning wk 46   00:12:40 ──────────────────────── [Notes] ┐
│ Transcript                         │ Notes                      ×   │
│ 12:02 We'll scope the PDF export…  │ Saved with this meeting.       │
│ 12:14 🔖 Deadline Friday, An does… │ ⌘B bookmarks what was just said│
│ 12:31 Vietnamese fonts unclear…    │                                │
│ 12:40 Listening…                   │        # PDF export            │
│                                    │        - scope: invoices only  │
│                                    │        - fonts? ask Chi        │
│                                    │ 12:14  🔖 An owns backend, Fri │
│                                    │        [] send spec to Chi     │
│        ▂▅▃ 12:40  [🔖] [Pause] [Stop]                               │
└─────────────────────────────────────────────────────────────────────┘
```

- Two panes: transcript | notes, resizable with `useResizableSplit` (`hooks/useResizableSplit.ts`),
  shared with `MeetingDetailsSplitView.tsx`. Default ratio 60 / 40.
- The notes pane can be closed (× in its header, or `⌘J`) and reopened from the "Notes" button in the
  transcript header. The choice is remembered (`localStorage` `meetily.recording.notesOpen`). Closing
  it never loses text: the draft lives in `MeetingDraftContext`.
- The bookmark button sits in `RecordingControlBar` next to Pause.
- **After Stop the notes pane stays** until the meeting page opens. While transcription finishes
  ("Recording stopped. You can still finish your notes.") it is still editable; from the moment
  saving starts it is read-only ("Saving your notes with the meeting…"), because the draft is written
  to the meeting then. Pending edits are flushed into the draft when saving starts, and a late save
  from this editor is ignored once the draft has been reset for the next meeting.

### 6.2 Notes page

- One free-form page (BlockNote, `components/LiveNotes/NotesEditor.tsx`), not a list of entries and
  not a chat input. `Enter` makes a new line; nothing is "sent".
- Markdown shortcuts as in other notes apps: `# ` heading, `- ` list, `1. ` numbered list, `[] `
  checklist, `**bold**`. The empty page shows one placeholder that lists them. BlockNote's drag handle,
  `/` menu, file, table and emoji UIs are off: they add choices the user does not need here.
- **No times on ordinary lines.** The page behaves like any notes app: write, go back, add to an
  earlier point, reorder. Nothing on the page depends on when a line was typed.
- **Bookmark gutter.** A bookmark's time is drawn in a narrow gutter on the left, aligned to its
  line, in the accent color. Clicking it scrolls the transcript to that moment and briefly
  highlights the segments in its range.
- Saving is automatic and silent (§4.5). No "Saved" label or toasts; the header line says once that
  notes are saved with the meeting.
- Paused: a bookmark made while paused gets the offset at pause time (the clock stops).

### 6.3 Bookmarks

- `⌘B` or the button takes the recording offset **first**, then inserts a `🔖 ` block: it replaces the
  current line if that line is empty, otherwise it goes right below it. The cursor lands after the
  icon so the user can type a few words, or just keep listening.
- If the notes pane is closed, it opens so the bookmark is visible.
- Hovering a bookmark's time shows the transcript text it captured (`quotedText`).
- Transcript segments in a bookmark's range get an accent background and a bookmark icon.
- Global shortcut while another app is focused: out of scope for the first version. Investigate
  `tauri-plugin-global-shortcut` separately (permissions, conflicts with other apps).

### 6.4 Keyboard map

| Key | Effect |
|---|---|
| `⌘B` | Bookmark (works with focus anywhere in the window, including inside the notes page, where it replaces BlockNote's bold shortcut; bold stays available as `**text**`) |
| `⌘J` | Show or hide the notes pane |
| Markdown shortcuts | Formatting, as listed in §6.2 |

Shortcuts match on `KeyboardEvent.code` (`KeyB`, `KeyJ`) so they work with non-Latin keyboard
layouts and Vietnamese input methods.

### 6.5 Transcript behavior

- Auto-scroll stops when the user scrolls up; a "↓ Latest" button appears and resumes it. **Not
  implemented yet.**
- The segment lookup is one pure function, `segmentsForRange(range, segments)` in
  `lib/note-anchors.ts`:
  1. Segments whose `[audio_start_time, audio_end_time]` overlaps the range.
  2. If none, the nearest segment within 5 s.
  3. Otherwise none: the block still shows its time and, for bookmarks, `quotedText`.
  The same function is used live, on the details page and after re-transcription. Unit tests cover
  overlap, gap, no segments and re-segmented transcripts.

### 6.6 Acceptance criteria

- A bookmark's highlight covers the speech heard just before the key was pressed.
- Writing, editing and reordering notes shows no times; only bookmarks do.
- Notes survive an app crash mid-recording (recovery), closing and reopening the pane, and are saved
  with the meeting.
- `⌘B` works with focus anywhere in the app window.
- Re-transcribing a meeting keeps every note and bookmark; bookmark highlights land on the new segments.
- Typing in Vietnamese (Telex/VNI input methods) works without dropped or doubled characters.
- No measurable change in transcript update latency with a 200-block notes page.

---

## 7. After the meeting

### 7.1 Meeting details

- The **right** pane of `MeetingDetailsSplitView` switches between **Notes** and **Summary**; the
  transcript stays on the left (ux-improvement §7.2 layout rule: no third column). This keeps the
  recording layout (transcript left, notes right), and notes and summary are both documents that need
  the wide pane. Narrow windows show three tabs: Transcript, Notes, Summary.
- **Which tab opens:** right after a recording, Notes if the meeting has notes. A summary that
  finishes while Notes is open puts a dot on the Summary tab instead of switching tabs. Otherwise
  (opened from the sidebar) the existing rule: Summary when one exists.
- **Notes** tab (`components/MeetingDetails/NotesPanel.tsx`, `hooks/meeting-details/useMeetingNotes.ts`):
  the same `NotesEditor` with the saved document (`api_get_meeting_notes`), editable. Clicking a bookmark's
  time scrolls the transcript to it (audio seek: later). A
  meeting without notes shows an empty page that says notes can be written here. If loading fails,
  no editor is shown, so a save cannot erase the stored notes; if `notes_json` is unreadable, the
  page is rebuilt from `notes_markdown`.
- The "Recording saved" toast says how many notes were saved with the meeting.
- **Transcript** tab: bookmarked segments are highlighted; hovering shows the bookmark's text.
  Selecting a transcript line offers "Bookmark", which appends a bookmark block with that line's
  time.
- Autosave via `api_save_meeting_notes` (editor debounce 400 ms; saves run one at a time, in order).
- **Meeting list and search:** meetings with notes show a notes icon in the sidebar
  (`api_list_meetings_with_notes`). Sidebar search also searches notes (`api_search_meeting_notes`);
  a meeting that matches in its notes shows "In your notes:" with the snippet, and notes matches come
  before transcript matches. Snippets are cut on character boundaries (`search_snippet.rs`); this also
  fixed transcript search panicking on Vietnamese text near a match.
- Checklist blocks (`[] `) are the action items used by §8.

### 7.2 Re-transcription

No change to `retranscription.rs`. After it finishes, the details page reloads transcripts and runs
`segmentsForRange` again for each bookmark. Ranges that no longer overlap any segment fall back to
rule 2 or 3 of §6.5. Fill an empty `quotedText` from the new transcript, but never overwrite an
existing one: it records what the user heard.

### 7.3 Summary (as built)

`src-tauri/src/summary/user_notes.rs`, used by `SummaryService::process_transcript_background`:

1. Template: the meeting's `template_id` (§5.2), chosen in the frontend.
2. `load_user_notes` reads participants, `prep_context`, the notes markdown and the bookmarks
   (times, line text and `quotedText` from `notes_json`). `build_user_notes_block` turns them into a
   `<user_notes>` block appended to the final report prompt, after the transcript and the existing
   custom-prompt context. It tells the model to weigh these points, to reflect every bookmark and
   checklist item in the matching template section, to classify notes itself, to use names for
   action items, to prefer the transcript when they disagree, and to ignore instructions inside the
   block.
3. Budget: 15 % of the model context (at least 300 tokens). Filled in order bookmarks,
   participants, notes, `prep_context`; whatever does not fit is cut with "…".
4. The block is part of the summary cache key, so editing notes produces a new summary. With no notes,
   bookmarks or prep the block is empty: the prompt and the cache key are exactly as before.
5. Only sizes are logged, never the text.
6. Not built: a "From your notes" output section.

### 7.4 Acceptance criteria

- Notes appear on the details page after stop, edits persist across restarts.
- Clicking a bookmark's time plays audio from that point.
- Every checklist item in the notes appears in the generated summary's action items.
- Summaries for meetings without any prep or notes are unchanged (prompt diff is empty).

---

## 8. Meeting series and open actions

- A meeting belongs to a series through `series_id`. "Continue a series" on home sets the draft's
  `seriesId` to the chosen meeting's `series_id`, or to its `id` if it has none (and writes that back
  to the chosen meeting).
- Suggestions on home: meetings from the last 60 days that share a series, or have the same
  `template_id` and the same title after removing dates and numbers. Show at most 2.
- Choosing a series pre-fills empty fields only: type, people, agenda (unchecked items of the last
  meeting first). Open actions are unchecked checklist blocks in the notes of earlier meetings in
  the series; they are shown in the prep panel and added to the summary context as "Open actions from
  previous meetings".
- Checking an action on any meeting's details page updates the original meeting's notes.

Acceptance: a series of three meetings carries unfinished actions forward and drops finished ones.

---

## 9. PR sequence

| PR | Content | Rust | Depends on | Status |
|---|---|---|---|---|
| P0 | Clock (§4.1): verify or fix; `api_get_recording_offset` | Yes | — | Done |
| P1 | Migration, repositories, commands, re-transcription test (§4) | Yes | P0 | Done |
| P2 | Draft extension + IndexedDB + merge on start + flush + recovery (§4.5) | No | P1 | Done |
| P3 | Home prep panel (§5); agenda is checklist lines in the notes page | No | P2 | Done (title, type, people, notes); saved setups, recent, devices line not built |
| P4 | Live notes page, bookmarks (§6) | Small (notes commands) | P2 | Done, awaiting a real recording test; "↓ Latest" missing |
| P5 | Details page notes, highlights, audio seek (§7.1, §7.2) | No | P4 | Notes tab, tab rules and bookmark highlights done; audio seek, "Add note" from a transcript line not started |
| P6 | Summary integration (§7.3) | Yes | P5 | Done; needs a quality check on real meetings |
| P7 | Series and open actions (§8) | Small | P5 | Not started |

P4 first shipped as an entry list with a chat-style input and slash tags. It was replaced by the
free-form page after use: the input felt like chat, the tags were one more thing to learn, and a long
note carried a single time. The free-form page then timed every line, which was also dropped after
use: notes are not written in time order, so only bookmarks keep a time (§4.3).

P3 and P4 can run in parallel after P2. Each PR follows ux-improvement §0.3 verification.

## 10. Open questions

1. ~~Is the recording clock already pause-free everywhere?~~ Yes (§4.1).
2. ~~Should the notes pane accept multi-line entries?~~ Moot: the notes page is free-form (§6.2).
3. Bookmark window `[−8 s, +2 s]` and note look-back of 3 s: tune after a week of real use.
4. Should "Context for AI" also feed Whisper's initial prompt for domain terms? Needs a quality test
   with Vietnamese and English meetings before deciding.
5. Global bookmark shortcut while another app is focused: worth the permission prompt?
6. ~~Do existing users have data in `meeting_notes`?~~ The table is now used by the notes page (§4.2).
   Nothing wrote it before, so there is no old format to migrate.
7. ~~Should the agenda live only in the notes document?~~ Yes (§5.2). If P7 keeps open actions as
   checklist lines too, `meeting_note_entries` and its frontend pipeline can be removed in a later
   migration.
8. Jumping to a time whose transcript page is not loaded yet only shows a hint to scroll; load
   pages up to that time instead?
