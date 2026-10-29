# Transcription

How speech segments become transcript text, locally, with Whisper or Parakeet. Paths are relative to
`frontend/src-tauri/src/`. Audio capture and voice activity detection are described in
[audio-pipeline.md](audio-pipeline.md).

## Engines

| | Whisper | Parakeet |
|---|---|---|
| Code | `whisper_engine/` (`whisper-rs` 0.13, whisper.cpp) | `parakeet_engine/` (NVIDIA NeMo TDT, ONNX Runtime via `ort`) |
| Config provider id | `localWhisper` | `parakeet` |
| Models | `tiny`, `base`, `small`, `medium`, `large-v3-turbo`, `large-v3` (`ggml-*.bin`) | `parakeet-tdt-0.6b-v3-int8` (~670 MB), `parakeet-tdt-0.6b-v2-int8` (~661 MB) |
| Default model | `large-v3-turbo` (`config.rs`) | `parakeet-tdt-0.6b-v3-int8` (`config.rs`) |
| Download source | Hugging Face `ggerganov/whisper.cpp` | v3: upstream's mirror (`meetily.towardsgeneralintelligence.com`); v2: Hugging Face `istupakov/...-onnx` |
| Language | Auto-detect, auto-detect + translate to English, or a chosen language | Auto-detect only |
| GPU | Metal/CoreML (macOS), CUDA, Vulkan, ROCm, OpenBLAS via Cargo features; decided at load time | ONNX Runtime (CPU) |

**When no transcription setting is saved, the app uses Parakeet** with its default model
(`audio/transcription/engine.rs`).

## Provider layer (`audio/transcription/`)

- `provider.rs`: the `TranscriptionProvider` trait (`transcribe`, `is_model_loaded`,
  `get_current_model`, `provider_name`) returning `TranscriptResult { text, confidence, is_partial }`.
  `whisper_provider.rs` and `parakeet_provider.rs` implement it.
- `engine.rs`: the `TranscriptionEngine` enum (`Whisper`, `Parakeet`, and the trait-based `Provider`
  variant preferred for new code). `get_or_init_transcription_engine` reads the saved setting
  (`api_get_transcript_config`, stored in the `transcript_settings` table) and returns a ready engine.
  `validate_transcription_model_ready` is called before recording starts so the UI can prompt for a
  model download.
- **Model changes need no restart:** at recording start, if the loaded Whisper model differs from the
  saved setting, the configured model is loaded instead. Engines also expose `load_model` /
  `unload_model`, and the UI calls `whisper_load_model` / `parakeet_load_model` from Settings.

## Live transcription (`audio/transcription/worker.rs`)

1. The pipeline sends each speech segment (mixed microphone + system audio, 48 kHz) to the worker.
2. The worker runs with **one worker task** (`NUM_WORKERS = 1`) so transcripts are emitted in
   chronological order.
3. Each result is emitted as `transcript-update` with a `TranscriptUpdate`:
   `text`, `timestamp` (wall clock), `source`, `sequence_id`, `is_partial`, `confidence`,
   `audio_start_time` / `audio_end_time` / `duration` (seconds from recording start), and the legacy
   `chunk_start_time`.
4. Other events: `speech-detected`, `transcription-error`.
5. On stop, the worker drains its queue before the recording is reported finished.

The UI (`useTranscriptStreaming`, `TranscriptContext`) shows segments as they arrive and writes them to
IndexedDB for crash recovery; they are saved to SQLite when the meeting is saved (`api_save_transcript`).

## Language

- The UI keeps the choice in `localStorage` (`primaryLanguage`, default `auto`) and sends it to Rust
  with `set_language_preference` at startup and on change (`ConfigContext.tsx`). Rust holds it in
  `LANGUAGE_PREFERENCE` (`lib.rs`), which starts as `auto-translate` until the UI sets it.
- Values: `auto` (detect), `auto-translate` (detect and translate to English, Whisper only), or a
  language code. Parakeet shows only the automatic options (`LanguageSelection.tsx`).

## Batch transcription

| Feature | Commands | Events | Code |
|---|---|---|---|
| Import an audio file as a new meeting | `select_and_validate_audio_command`, `validate_audio_file_command`, `start_import_audio_command`, `cancel_import_command`, `is_import_in_progress_command` | `import-progress`, `import-warning`, `import-complete`, `import-error` | `audio/import.rs` |
| Re-transcribe an existing meeting (other model or language) | `start_retranscription_command`, `cancel_retranscription_command`, `is_retranscription_in_progress_command` | `retranscription-progress`, `retranscription-complete`, `retranscription-error` | `audio/retranscription.rs` |

- Supported files (`audio/constants.rs`): mp4, m4a, wav, mp3, flac, ogg, aac, mkv, webm, wma. Files
  are decoded with the `ffmpeg` sidecar (`audio/decoder.rs`).
- Batch VAD uses a 2000 ms redemption time (vs 500 ms live) so speech is not split at every pause.
- Only one import and one re-transcription can run at a time (`IMPORT_IN_PROGRESS` and equivalents).
- The UI exposes import as a beta feature (`ImportDialogContext`).

## Quality filters

- **Repetition cleanup** (`whisper_engine.rs`: `clean_repetitive_text`, `remove_word_repetitions`,
  `remove_phrase_repetitions`) removes Whisper's looping output.
- Whisper decoding settings (`whisper_engine.rs`): `set_no_timestamps(true)` to stop
  timestamp-based segment skipping; `no_speech_thold` 0.55 (lowered from 0.75 so quiet speech is
  kept while still suppressing hallucinations); `entropy_thold` 2.4; `logprob_thold` −1.0.

## Models: download and storage

- Stored in `<app data>/models/` (see [data-storage.md](data-storage.md)); open the folder with
  `open_models_folder` / `open_parakeet_models_folder`.
- Download commands: `whisper_download_model`, `parakeet_download_model` (+ `parakeet_retry_download`),
  cancel and "delete corrupted model" variants. Progress events: `model-download-progress`,
  `model-download-complete`, `model-download-error`. Parakeet files are checked against exact sizes.
- UI: `WhisperModelManager.tsx`, `ParakeetModelManager.tsx`, `lib/whisper.ts`, `lib/parakeet.ts`,
  `useTranscriptionModels`.

## Not in use

`whisper_engine/parallel_processor.rs` and `parallel_commands.rs` register 11 commands that the UI
never calls (TD-20). Do not build on them without discussing it first.

## Changing transcription safely

- Engine calls run off the audio thread, but the worker is on the live path: no blocking I/O, and
  no transcript text in `info!` logs (TD-18).
- Keep output order: anything that parallelizes the worker must still emit by `sequence_id` order.
- Test both engines, with `auto` and a fixed language, live and via import.
