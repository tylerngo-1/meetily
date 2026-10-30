# Logging

How logging is set up, where logs go, and the rules for adding log lines. Paths are relative to
`frontend/src-tauri/src/` unless they start with `frontend/`.

## How it works today

- The Rust core logs through the `log` crate with `env_logger`, which writes to **stderr**.
  Nothing writes a log file. (`tauri-plugin-log` is a dependency but is never registered.)
- `main.rs` sets `RUST_LOG=info` before `env_logger::init()`, and `run()` in `lib.rs` calls
  `log::set_max_level(Info)`. **So `RUST_LOG` has no effect and `debug`/`trace` lines never print,
  even in dev builds** (TD-32). Scripts that take a log level (`clean_run.sh debug`) are affected too.
- Where to see logs:
  - Dev app: the terminal running `pnpm run tauri:dev`.
  - Release builds started from Finder or the Start menu: stderr is not shown anywhere you can read.
  - `show_console` (`console_utils/`): on Windows it opens a console window; on macOS it opens
    Terminal running `log stream --process meetily`, which shows macOS's unified log, not the
    app's stderr. No screen in the UI calls it (`components/ConsoleToggle.tsx` is not rendered).
- Frontend `console.*` output appears only in the developer tools of a dev build
  ([testing.md](testing.md#debugging)).

## Rules

1. **Use the `log` macros** (`log::info!`, `log::warn!`, `log::error!`, ...). Several modules alias
   them as `log_info!`, `log_error!` (`use log::{info as log_info, ...}`). No `println!`/`dbg!` in
   app code (some remain; TD-17).
2. **Never block or log per item in the audio hot path** (capture callbacks, `audio/pipeline.rs`,
   transcription workers):
   - Use `perf_debug!` / `perf_trace!` (defined at the top of `lib.rs`, usable in any module).
     They compile to nothing in release builds. While TD-32 is open they print nothing in dev either.
   - Aggregate per-chunk metrics with `batch_audio_metric!` and `AudioMetricsBatcher`
     (`audio/batch_processor.rs`; batches of 50 chunks or 5 seconds). Note: the summaries are
     collected but nothing reads or logs them yet (TD-34).
   - Rate-limit anything that can repeat per chunk, e.g. log every 100th occurrence:
     ```rust
     if error_count % 100 == 1 {
         log::warn!("Frequent warning (showing every 100th): {}", warning);
     }
     ```
3. **Errors use plain `log::error!`**, never a macro that is compiled out.
4. **Privacy:** never log transcript text, summaries, audio content, meeting titles or API keys at
   `info` or above; users share logs in bug reports. Some existing code still logs transcript text
   (TD-18). `perf_debug!`/`perf_trace!` lines in `whisper_engine.rs` include transcript text, which is
   acceptable only because they are debug-only.
5. Keep `info` for state changes (recording started/stopped, model loaded, device switched), one
   line per event.

## Also available

- `async_debug!` / `async_info!` / `async_warn!` (`audio/async_logger.rs`) hand messages to a
  background task that flushes every 100 ms. The channel is unbounded, so they never block but also
  never drop messages. Nothing uses them today; prefer the rules above.

## When logging is fixed (TD-32)

Once `main.rs` stops overriding `RUST_LOG` and `lib.rs` stops capping the level, these will work:

```bash
cd frontend
RUST_LOG=debug pnpm run tauri:dev                   # everything at debug
RUST_LOG=app_lib::audio=debug pnpm run tauri:dev    # one module (the crate is app_lib)
```

Update this file, the root `AGENTS.md` and [building.md](building.md) in the same commit as the fix.
