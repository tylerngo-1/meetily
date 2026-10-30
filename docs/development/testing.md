# Testing and Debugging

How to check a change before you finish: automated checks, the manual smoke test, test data and
debugging tools. There is no test CI (TD-04); these local checks are the only safety net.

## Which checks to run

| You changed | Run |
|---|---|
| Anything in `frontend/src/` | `npx tsc --noEmit` and `npx bun@1.3.14 test` (from `frontend/`) |
| Anything in `frontend/src-tauri/` | `cargo check` and `cargo test --lib` (from `frontend/src-tauri/`) |
| Recording, the sidebar or meeting details | The above, plus the [manual smoke test](#manual-smoke-test) |
| `.github/verify-portable-ggml.cjs` | `node --test .github/verify-portable-ggml.test.cjs` (from the repo root) |
| Notifications | [Notification testing](#notification-testing-macos) |
| Docs only | Check the links you touched |

Do not run `pnpm run lint`: there is no ESLint config and it opens an interactive prompt (TD-01).

## Frontend tests

```bash
cd frontend
npx tsc --noEmit                                      # type check
npx bun@1.3.14 test                                   # all tests (11 files, 48 tests)
npx bun@1.3.14 test tests/lib/format-duration.test.ts # one file
```

- Bun is not a declared dependency, so the version is pinned on the command line (TD-02).
- `tests/lib/` tests pure helpers from `src/lib/`; `tests/hooks/` renders hooks with
  `react-test-renderer`.
- Tests run without Tauri. Mock `@tauri-apps/api/core` with `mock.module(...)` **before** importing
  the module under test (use `await import(...)` after the mock), as in `tests/lib/analytics.test.ts`.
- Bun shares `mock.module` mocks across files: save the original module and restore it in
  `afterAll` (see `tests/hooks/summary-generation.test.tsx`).

## Rust tests

```bash
cd frontend/src-tauri
cargo check
cargo test --lib
```

- **Known failure:** `audio::device_detection::tests::test_builtin_mic_detection` (TD-03); the rest
  pass (245 passed, 3 ignored when last counted). Any other failure is new.
- Tests are unit tests inside the modules (`#[cfg(test)]`); there are no integration tests.
  `tests/fixtures/he_aac_48k_5s.m4a` is used by the decoder tests in `src/audio/decoder.rs`.
- The first build downloads `ffmpeg` and needs the `llama-helper` sidecar in `binaries/`
  ([building.md](building.md#2-first-build)).

## Manual smoke test

Run it in the dev app (`pnpm run tauri:dev`), never the installed daily app:

1. Start a recording from the home screen, and once from the sidebar.
2. Speak for about 30 seconds and confirm the live transcript appears.
3. Pause, resume, then stop.
4. Confirm the meeting opens and its summary generates.
5. Restart the app and confirm the meeting is still there.

## Test data

`scripts/inject_transcript.py` creates a meeting from a CSV file with a `text` column (one segment
per row), without recording:

```bash
python3 scripts/inject_transcript.py --csv transcript.csv --title "Test meeting" \
  --db "$HOME/Library/Application Support/com.meetily.ai.dev/meeting_minutes.sqlite"
```

- **Always pass `--db` with the dev database** (`com.meetily.ai.dev`). The script's default path
  (`~/Library/Application Support/Meetily/` on macOS) does not match the app (TD-33), and pointing
  it at `com.meetily.ai` would write into the daily app's data.
- Other options: `--created-at`, `--folder-path`. Quit the dev app first.

## Notification testing (macOS)

Notifications are handled in `frontend/src-tauri/src/notifications/`. At every startup the app
initializes the notification manager, sets consent to `true` and requests permission (`lib.rs`),
then shows a notification when a recording starts if that notification is enabled in the app's
preferences (`show_recording_started`, off by default in `notifications/settings.rs`). Settings are saved in
`dirs::config_dir()/meetily/notifications.json` (shared by the dev and daily apps; TD-15).

Call these with `invoke` from `@tauri-apps/api/core`, for example from a temporary button in the
dev app (`withGlobalTauri` is off, so the developer tools console has no `window.__TAURI__`):

| Command | Does |
|---|---|
| `test_notification_with_auto_consent` | Initializes the system if needed, grants consent and shows a test notification |
| `initialize_notification_manager_manual`, then `show_test_notification` | The same, in two steps |
| `is_notification_system_ready`, `get_notification_stats`, `get_notification_settings` | Status |
| `get_system_dnd_status` | Whether Do Not Disturb is on |
| `request_notification_permission`, `set_notification_consent` (`{ consent: true }`) | Permission and consent |

Expected: a native notification titled "Meetily". If none appears, check System Settings →
Notifications for the app, Do Not Disturb or Focus, and the terminal log for notification
initialization errors.

## Debugging

- **Developer tools** (dev builds only; release builds do not enable them): right-click →
  Inspect, or `Cmd+Option+I` on macOS, `Ctrl+Shift+I` on Windows and Linux. Frontend
  `console.*` output and failed `invoke` calls show up here.
- **Rust logs** go to the terminal that runs `pnpm run tauri:dev`, `info` and above only; `RUST_LOG`
  currently has no effect. See [logging.md](logging.md).
- **`pnpm run dev`** serves only the UI in a browser; every `invoke` fails there, so it is useful for
  layout work only.
