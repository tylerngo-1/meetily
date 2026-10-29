# Data Storage

Where Meetily keeps its data, what each store holds, and how the database schema changes.
Paths in code references are relative to `frontend/src-tauri/` unless they start with `frontend/src/`.

## Locations

`<app data>` is Tauri's `app_data_dir()`, named after the app identifier
(`com.meetily.ai` for the installed app, `com.meetily.ai.dev` for dev builds):

| OS | `<app data>` |
|---|---|
| macOS | `~/Library/Application Support/<identifier>/` |
| Windows | `%APPDATA%\<identifier>\` |
| Linux | `~/.local/share/<identifier>/` (or `$XDG_DATA_HOME`) |

| What | Where | Code |
|---|---|---|
| SQLite database | `<app data>/meeting_minutes.sqlite` (+ `-wal`, `-shm` while open) | `src/database/manager.rs` |
| Whisper models | `<app data>/models/ggml-*.bin` | `src/whisper_engine/commands.rs` |
| Parakeet models | `<app data>/models/parakeet/` | `src/parakeet_engine/commands.rs` |
| Built-in AI models | `<app data>/models/summary/` | `src/summary/summary_engine/model_manager.rs` |
| Preference stores (`tauri-plugin-store`) | `<app data>/recording_preferences.json`, `onboarding-status.json` | `src/audio/recording_preferences.rs`, `src/onboarding.rs` |
| Recordings | Default: macOS `~/Movies/meetily-recordings`, Windows `Music\meetily-recordings`, Linux `~/Documents/meetily-recordings`; changeable in Settings | `src/audio/recording_preferences.rs` |
| Custom summary templates | `dirs::data_dir()/Meetily/templates/` (macOS `~/Library/Application Support/Meetily/templates/`, Windows `%APPDATA%\Meetily\templates\`, Linux `~/.local/share/Meetily/templates/`) | `src/summary/templates/loader.rs` |
| Notification settings | `dirs::config_dir()/meetily/notifications.json` | `src/notifications/settings.rs` |
| Crash-recovery copy of live transcripts | Webview IndexedDB `MeetilyRecoveryDB` | `frontend/src/services/indexedDBService.ts` |
| UI preferences (language, small UI state) | Webview `localStorage` | `frontend/src/contexts/ConfigContext.tsx` and others |

- Custom templates and notification settings sit **outside** `<app data>`, so dev and installed
  builds share them (TD-15). The source comment in `loader.rs` gives a wrong Linux path (TD-14).
- Open folders from the app with `open_database_folder`, `open_models_folder`,
  `open_parakeet_models_folder`; `get_database_directory` returns the database folder.

## Meeting folders

Each recording gets a folder in the recordings location (name from the meeting title, with `_2`,
`_3`, ... appended on clashes; see [audio-pipeline.md](audio-pipeline.md)):

| File | Contents |
|---|---|
| `audio.mp4` | Full recording, merged from checkpoints when the recording stops (absent if `auto_save` is off) |
| `.checkpoints/audio_chunk_NNN.mp4` | 30-second checkpoints while recording; removed after a successful merge |
| `transcripts.json` | Transcript segments |
| `metadata.json` | Meeting metadata; also holds the per-meeting summary language (`src/summary/metadata.rs`) |

The folder path is stored in `meetings.folder_path`. **Deleting a meeting removes its database rows
but leaves the folder on disk.** Imported audio files get a meeting folder the same way.

## SQLite database

Opened with `sqlx` (WAL journal). Startup (`src/database/setup.rs`):

1. If `meeting_minutes.sqlite` does not exist, no database is opened yet. The UI asks
   `check_first_launch`, and onboarding lets the user import a legacy database or start fresh
   (`initialize_fresh_database`). (Rust also emits `first-launch-detected`, which the UI does not use.)
2. Otherwise `DatabaseManager::new_from_app_handle` opens it and runs all pending migrations.
3. If opening fails because of an orphaned WAL file, the `-wal`/`-shm` files are deleted and the
   open is retried. On exit, `cleanup` runs `PRAGMA wal_checkpoint(TRUNCATE)`.

Data access goes through `src/database/repositories/` (`meeting.rs`, `transcript.rs`,
`summary.rs`, `setting.rs`, `transcript_chunk.rs`); models are in `src/database/models.rs`.

### Tables

| Table | Holds | Notes |
|---|---|---|
| `meetings` | `id`, `title`, `created_at`, `updated_at`, `folder_path`, `title_user_set` | `title_user_set = 1` stops generated names from overwriting a user's title |
| `transcripts` | One row per segment: `transcript`, `timestamp`, `audio_start_time`, `audio_end_time`, `duration`, `speaker` | `speaker` is never filled (no diarization). `summary`/`action_items`/`key_points` columns are legacy |
| `summary_processes` | One row per meeting: `status`, `result`, `error`, timings, `chunk_count`, `metadata`, `result_backup`, `result_backup_timestamp` | The previous result is backed up before a regeneration; see [summarization.md](summarization.md) |
| `transcript_chunks` | One row per meeting: full transcript text plus the model and chunking used for the summary | |
| `settings` | Summary provider, model, Whisper model, API keys per provider, `ollamaEndpoint`, `customOpenAIConfig` (JSON) | Single row. Keys are plain text (TD-24). `geminiApiKey` has no provider (TD-16) |
| `transcript_settings` | Transcription provider and model | Single row. Its API key columns are still read and written by the settings code, but no engine uses them (both are local) |
| `licensing` | Upstream's Pro license fields | No live code reads it (TD-22) |
| `meeting_notes` | Per-meeting notes | No live code reads it (TD-22) |

Deleting a meeting deletes its rows from `transcript_chunks`, `summary_processes`, `transcripts`
and `meetings` (`repositories/meeting.rs`).

### Migrations

Files in `frontend/src-tauri/migrations/`, embedded at build time with `sqlx::migrate!` and applied
automatically at startup. sqlx records each applied migration (name and checksum) in
`_sqlx_migrations`.

- **Add** a new file `YYYYMMDDHHMMSS_description.sql`, timestamped after the newest existing one.
- **Never edit, rename or delete** a migration that has run anywhere. A changed file fails the
  checksum check; a database that contains a migration the app does not know makes the app refuse
  to start (`migration ... was previously applied but is missing in the resolved migrations`).
- **Keep it additive:** `ALTER TABLE ... ADD COLUMN` (with a default if `NOT NULL`),
  `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. SQLite cannot drop or change a column
  in place; the table-rebuild pattern (`settings_new` in `20250920155811_add_openrouter_api_key.sql`)
  is a last resort and must copy every existing row.
- The app cannot undo a migration, and an older app cannot open a database with newer migrations.
- After adding columns, update the structs in `models.rs` and every query that selects or inserts
  that table. sqlx queries here are checked at runtime, not compile time, so a mismatch shows up
  only when the query runs.

This fork's extra rules (try migrations in the dev app first, no official updater, upstream
filenames) are in [local-workflow.md](../development/local-workflow.md#database-migrations-rules).

## Legacy database import

Users of the old Python backend had `meeting_minutes.db`. Import is handled in Rust
(`src/database/commands.rs`, `manager.rs`), never by running `backend/`:

- During onboarding the user picks a file or folder (`select_legacy_database_path`).
  `detect_legacy_database` accepts the `.db` file itself, a folder containing `meeting_minutes.db`,
  or a repo root with `backend/meeting_minutes.db`.
- `check_homebrew_database` looks for the Homebrew install's database
  (`/opt/homebrew/var/meetily/` and `/usr/local/var/meetily/`).
- `import_and_initialize_database` copies the file to `<app data>/meeting_minutes.db`. When
  `meeting_minutes.sqlite` does not exist, startup copies that `.db` to `.sqlite`, then runs the
  migrations on it.

## Crash recovery (IndexedDB)

While recording, the UI writes the meeting and each transcript segment to IndexedDB
(`MeetilyRecoveryDB`, stores `meetings` and `transcripts`). If the app closes before the meeting is
saved, the home page offers to recover it (`useTranscriptRecovery`, `TranscriptRecovery`).
Entries older than 7 days are deleted at startup. IndexedDB lives in the webview's own storage, not
in the files listed above, so do not assume a file backup of `<app data>` includes it.

## Backup and rollback

- Everything needed to restore a user's meetings: `<app data>/meeting_minutes.sqlite` (with the app
  quit, or including `-wal`) plus the recordings folder.
- This fork's install script backs up the app and `<app data>` before each install; restoring
  needs both the old app and the matching data backup:
  [local-workflow.md](../development/local-workflow.md#rolling-back-the-daily-app).
- Backups contain the plain-text API keys from `settings` (TD-24).
