# Recipes

Checklists for changes that come up repeatedly. Paths starting with `src-tauri/` or `src/` are
under `frontend/`. Each recipe ends with the checks from [testing.md](testing.md#which-checks-to-run).
Before starting, read the folder `AGENTS.md` for the area you change.

## 1. Add a Tauri command

1. Write the function in the module it belongs to (usually `src-tauri/src/<module>/commands.rs`):
   ```rust
   #[tauri::command]
   pub async fn my_command<R: Runtime>(
       app: AppHandle<R>,
       state: tauri::State<'_, AppState>,   // only if needed
       meeting_id: String,
   ) -> Result<MyResult, String> { ... }
   ```
   Return `Result<_, String>`; the error string reaches the UI as a rejected promise.
2. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`, with its module path
   (`my_module::commands::my_command`). An unregistered command fails at runtime, not at compile time.
3. Call it from the UI with camelCase arguments: `invoke<MyResult>('my_command', { meetingId })`.
   Prefer adding the call to an existing wrapper in `src/services/`.
4. Catch the error in the UI and show a `toast.error(...)` that says what to do.

## 2. Add a database migration or column

1. Add `src-tauri/migrations/YYYYMMDDHHMMSS_description.sql`, timestamped after the newest file.
   Additive only; never edit an existing migration. Rules: [data-storage.md](../architecture/data-storage.md#migrations).
2. Update the struct in `src-tauri/src/database/models.rs` (with `#[sqlx(rename = ...)]` /
   `#[serde(rename = ...)]` for camelCase columns).
3. Update every query that reads or writes the table in `src-tauri/src/database/repositories/`.
   Queries are checked only when they run, so exercise each one in the dev app.
4. Try it in the dev app first, on a copy of real data if possible
   ([local-workflow.md](local-workflow.md#database-migrations-rules)).

## 3. Add a setting

First decide where it lives:

| Kind | Store | Use for | Examples |
|---|---|---|---|
| Summary and transcription config | SQLite `settings` / `transcript_settings` row | Provider, model, API keys | `api_get_model_config`, `api_save_model_config` (`src-tauri/src/api/api.rs`) |
| Rust-side preference | `tauri-plugin-store` file in `<app data>` | Values Rust needs without the UI | `recording_preferences.json` (`RecordingPreferences` in `src-tauri/src/audio/recording_preferences.rs`) |
| UI-side preference | `tauri-plugin-store` file opened from the UI (`load('...json')`) | UI preferences kept in `<app data>` | `preferences.json` (`RecordingSettings.tsx`), `analytics.json` (consent) |
| UI convenience | `localStorage` | Small UI state | `providerModelMap`, `isAutoSummary`, `showConfidenceIndicator` (`ConfigContext.tsx`) |

- **SQLite:** follow recipe 2 for the column, add it to `SettingsRepository`
  (`src-tauri/src/database/repositories/setting.rs`) and to the command that reads/writes it, then
  to `ConfigContext` / `configService.ts`.
- **Rust store:** add the field to the struct with `#[serde(default)]` so existing files still load,
  and set its value in `Default`.
- Settings that Rust must know at startup never go in `localStorage`.

## 4. Add an LLM provider

Search for an existing provider (`openrouter`) to find every place; today that is:

**Rust (`src-tauri/src/`)**
1. `summary/llm_client.rs`: add the `LLMProvider` variant, its `from_str` name, and the endpoint and
   headers in the request `match` (OpenAI-compatible providers share one path; Claude has its own).
2. `summary/service.rs`: check how the API key and chunk size are chosen for the new provider
   (cloud providers get one pass; local ones use the model's context window).
3. API key: a migration adding `<provider>ApiKey` to `settings` (recipe 2), the field in
   `database/models.rs`, and the three `match provider` blocks in
   `database/repositories/setting.rs` (save, get, delete).
4. Optional model listing: a `<provider>/` module with a command (like
   `openrouter::get_openrouter_models`), registered in `lib.rs`.

**UI (`src/`)**
5. The provider union types in `components/ModelSettingsModal.tsx` and `services/configService.ts`.
6. The model list and API key handling in `ModelSettingsModal.tsx`, the provider list in
   `contexts/ConfigContext.tsx` (API key loading), and the `<option>` in `app/_components/SettingsModal.tsx`.

**Docs and privacy**
7. Add it to the provider table in [summarization.md](../architecture/summarization.md). Transcript
   text may go only to the provider the user selected (root `AGENTS.md`, rule 8). Keys are stored in
   plain text (TD-24).

Test with a short and a long (chunked) transcript.

## 5. Add a built-in summary template

1. Add `src-tauri/templates/<id>.json`; the file name is the template id. Format:
   [templates/README.md](../../frontend/src-tauri/templates/README.md).
2. Nothing else to register: `templates/*.json` is bundled by `tauri.conf.json`, and
   `api_list_templates` lists every bundled and custom template.
3. Check it with `api_validate_template`, then generate a summary with it in the dev app.
4. Only `standard_meeting` and `daily_standup` are compiled in as fallbacks
   (`summary/templates/defaults.rs`); do not add more there unless the fallback must change.

## 6. Send an event from Rust to the UI

1. Emit with `use tauri::Emitter;` and `app.emit("kebab-case-name", payload)`; the payload must
   implement `Serialize` (or use `serde_json::json!`).
2. Listen in the UI with `listen('kebab-case-name', ...)` and unlisten on unmount, using the pattern
   in [src/AGENTS.md](../../frontend/src/AGENTS.md#talking-to-the-rust-core).
3. Grep for the name on both sides before finishing; there is no central list, and a listener for an
   event nobody emits fails silently (TD-23).
4. Never emit once per audio chunk; throttle or batch anything tied to audio (see [logging.md](logging.md#rules)).

## 7. Change dependencies

- **JavaScript:** from `frontend/`, with pnpm 9.15.9: `pnpm add <pkg>` (or `pnpm remove`). Commit
  `pnpm-lock.yaml` with the change; everyone else installs with `--frozen-lockfile`.
- **Rust:** from `frontend/src-tauri/`: `cargo add <crate>`. The lockfile is the workspace's
  `Cargo.lock` at the repository root; commit it. `[patch]` and `[profile]` sections only work in the
  root `Cargo.toml` (TD-25, TD-27).
- Do not add UI libraries; use the primitives in `src/components/ui/`.
- Run all checks for both sides; a Rust dependency change needs a full `cargo check`.

## 8. Add a frontend test

1. Put pure logic in `src/lib/` (or a hook) so it can run without Tauri.
2. Add `frontend/tests/lib/<name>.test.ts` (or `tests/hooks/<name>.test.tsx`) using `bun:test`.
3. Mock Tauri before importing the module under test, and restore shared mocks in `afterAll`
   ([testing.md](testing.md#frontend-tests)).
4. Run `npx bun@1.3.14 test tests/lib/<name>.test.ts`, then the whole suite.

## 9. Add a page

1. Add `src/app/<route>/page.tsx` with `'use client'`.
2. The app is a static export: no dynamic route segments (`[id]`), API routes or server actions.
   Pass ids as query parameters and read them with `useSearchParams()` inside a `<Suspense>`
   boundary, as `app/meeting-details/page.tsx` does.
3. Navigate with `useRouter().push('/route?id=...')`.

## 10. Add an analytics event

1. Track through `Analytics` in `src/lib/analytics.ts` (`Analytics.track(name, properties)` or a
   named helper next to the existing ones); it calls the Rust `track_event` command (`src-tauri/src/analytics/`).
2. Analytics is opt-in: `Analytics.init()` runs only after consent (stored in `analytics.json`;
   `AnalyticsProvider.tsx`, `AnalyticsConsentSwitch.tsx`), and `track` does nothing before init.
   Do not bypass `Analytics` with a direct `invoke('track_event', ...)`.
3. Properties may contain random ids, counts, durations, error codes and model names, **never**
   titles, transcript text, summaries or file paths (root `AGENTS.md`, rule 8).
4. Update `components/AnalyticsDataModal.tsx`, which tells users what is collected.

## 11. Add a transcription or Built-in AI model

Search for an existing model name to find every list:

| Engine | Rust | UI |
|---|---|---|
| Whisper | Download URL in `download_model` (`src-tauri/src/whisper_engine/whisper_engine.rs`; search `large-v3-turbo`) | Model metadata in `src/lib/whisper.ts` |
| Parakeet | `PARAKEET_MODEL_SPECS` and its artifact lists (`src-tauri/src/parakeet_engine/parakeet_engine.rs`) | `src/lib/parakeet.ts` |
| Built-in AI | `get_available_models` (`src-tauri/src/summary/summary_engine/models.rs`) | None: the UI asks Rust (`builtin_ai_list_models`) |

Download the model in the dev app, record or import audio with it (or generate a summary), and
update the model list in [transcription.md](../architecture/transcription.md) or
[summarization.md](../architecture/summarization.md).
