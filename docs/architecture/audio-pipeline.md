# Audio Pipeline

How Meetily captures microphone and system audio, turns it into one mixed stream, and feeds both the
recording file and live transcription. Code is under `frontend/src-tauri/src/audio/`; paths below are
relative to that folder. Read [frontend/src-tauri/AGENTS.md](../../frontend/src-tauri/AGENTS.md)
before changing anything here: this is the app's hot path.

## Overview

```
Microphone ──► AudioCapture (mic):    mono → resample 48 kHz → high-pass → [noise suppression, off] → EBU R128 −23 LUFS ─┐
                                                                                                                       ├─► ring buffer ─► mixer ─► mixed 48 kHz mono
System audio ─► AudioCapture (system): mono → resample 48 kHz ────────────────────────────────────────────────────────┘                    │
                                                                                                                            ┌────────────────┴────────────────┐
                                                                                                                            ▼                                 ▼
                                                                                                                  Silero VAD (16 kHz)              recording saver
                                                                                                                  speech segments                  30 s checkpoints
                                                                                                                            ▼                                 ▼
                                                                                                                  transcription worker             audio.mp4 (ffmpeg concat)
                                                                                                                  → `transcript-update`
```

Key point: **recording and transcription receive the same mixed stream.** The difference is that
transcription only gets the speech segments that voice activity detection (VAD) finds, while the
recording gets everything.

## 1. Capture

Each source runs as its own stream and pushes `AudioChunk`s (samples, sample rate, device type,
chunk id, timestamp) into the pipeline over an unbounded Tokio channel created by `AudioPipelineManager`
(`pipeline.rs`). `recording_manager.rs` creates the two output channels: speech segments to
transcription and mixed audio to the recording saver.

| Source | macOS | Windows | Linux |
|---|---|---|---|
| Microphone | CPAL input device (`capture/microphone.rs`) | CPAL input device | CPAL input device |
| System audio | **Core Audio tap** (default; aggregate device + process tap, `capture/core_audio.rs`) or **ScreenCaptureKit** via CPAL (`stream.rs`) | WASAPI **loopback** on the output device (`devices/platform/windows.rs`) | PulseAudio **monitor** source through the ALSA host (`devices/platform/linux.rs`) |

- The macOS backend is chosen in Settings (`AudioBackendSelector.tsx` → `set_audio_backend`;
  config in `capture/backend_config.rs`). No virtual device such as BlackHole is needed.
- macOS permissions (`frontend/src-tauri/Info.plist`): microphone, screen capture, and audio capture
  (required for Core Audio taps on macOS 14.4+; checked in `permissions.rs`).
- Device discovery and naming: `devices/` (`discovery.rs`, `microphone.rs`, `speakers.rs`,
  `configuration.rs`, `platform/`). Use the words "microphone" and "system", not input/output.

## 2. Per-source processing (`pipeline.rs`, `AudioCapture::process_audio_data`)

| Step | Microphone | System |
|---|---|---|
| Convert to mono | ✅ | ✅ |
| Resample to 48 kHz (`rubato`, persistent resampler with buffering to keep energy constant across chunks) | ✅ if needed | ✅ if needed |
| High-pass filter (`HighPassFilter`) | ✅ | — |
| Noise suppression (RNNoise via `NoiseSuppressionProcessor`) | Off: `RNNOISE_APPLY_ENABLED = false` in `ffmpeg_mixer.rs` | — |
| Loudness normalization to −23 LUFS (EBU R128, `LoudnessNormalizer`, `ebur128` crate) | ✅ | — |

Helpers live in `audio_processing.rs`. Order matters: noise is removed before normalization so it is
not amplified.

## 3. Mixing (`pipeline.rs`)

- **`AudioMixerRingBuffer`** keeps a buffer per source and releases fixed **600 ms windows**
  (28,800 samples at 48 kHz). A window is released as soon as *either* source has a full window; the
  other source is zero-padded. This keeps recording working when only one source has audio, and
  makes the two sources line up even though they arrive at different rates.
- **`ProfessionalAudioMixer::mix_window`** adds microphone and system samples at full level (no
  ducking). If a sample's sum exceeds ±1.0 it is scaled back to ±1.0 to avoid hard clipping.
  Comments in this function mention 70 % system scaling and 50 ms windows; the code does neither (TD-21).

## 4. Transcription path

- **VAD** (`vad.rs`): Silero VAD at 16 kHz in 30 ms frames, run on the mixed stream. Settings:
  speech threshold 0.50 / 0.35, 300 ms pre-speech padding, 250 ms minimum speech, redemption time
  500 ms for live recording (`VAD_REDEMPTION_TIME_MS` in `pipeline.rs`) and 2000 ms for batch
  import/re-transcription, where latency does not matter and a short redemption would split speech
  at every pause (see [transcription.md](transcription.md)).
- Each speech segment becomes an `AudioChunk` sent to the transcription worker
  (`transcription/worker.rs`), which emits `transcript-update`. Details in [transcription.md](transcription.md).
- On stop, flush signals (special chunk ids near `u64::MAX`) make the pipeline flush the VAD so the
  last words are transcribed. The loop runs until the channel closes, not until the recording flag
  changes, so no queued audio is lost.

## 5. Recording path

- Mixed windows go to the recording saver (`recording_saver.rs`). If the recording preference
  `auto_save` is off, audio is discarded and only transcripts and metadata are kept.
- `incremental_saver.rs` writes a checkpoint every **30 seconds**
  (`.checkpoints/audio_chunk_NNN.mp4` in the meeting folder) to keep memory flat and survive crashes.
- On stop the checkpoints are merged with the `ffmpeg` sidecar's concat demuxer (no re-encoding) into
  **`audio.mp4`**. The meeting folder also holds `metadata.json` and `transcripts.json`, written atomically.
- The meeting folder is created by `create_meeting_folder` (`audio_processing.rs`) under the
  recordings folder; if the name already exists, `_2`, `_3`, ... is appended.
  Locations: [data-storage.md](data-storage.md).

## 6. Devices during a recording

| Concern | Code |
|---|---|
| Disconnect / reconnect of a device in use; microphone switching. Detected in `device_monitor.rs`, handled in `recording_manager.rs`; events `mic-device-switched`, `mic-swap-failed`, `mic-unavailable` are emitted from `recording_commands.rs` | `device_monitor.rs`, `recording_manager.rs`, `recording_commands.rs` |
| Bluetooth playback device warning (Bluetooth headsets degrade capture) | `playback_monitor.rs`, `device_detection.rs` |
| Level meters in device settings (separate streams; **never start during a recording**) | `level_monitor.rs`, `simple_level_monitor.rs`, command `start_audio_level_monitoring` |
| Pre-allocated buffers (16 × 1 s at 48 kHz, owned by `RecordingState`) | `buffer_pool.rs` |

## Module map

```
audio/
├── capture/             microphone.rs, system.rs, core_audio.rs (macOS tap), backend_config.rs
├── devices/             discovery.rs, microphone.rs, speakers.rs, configuration.rs, platform/{macos,windows,linux}.rs
├── transcription/       engine.rs, provider.rs, whisper_provider.rs, parakeet_provider.rs, worker.rs
├── pipeline.rs          AudioCapture (per source), AudioMixerRingBuffer, ProfessionalAudioMixer, AudioPipeline(Manager)
├── vad.rs               Silero VAD wrapper
├── audio_processing.rs  mono conversion, filters, loudness normalizer, meeting folder creation
├── recording_manager.rs starts/stops capture, pipeline and saver; device events
├── recording_commands.rs  Tauri commands: start/stop/pause/resume recording
├── recording_state.rs   shared recording state (atomics, devices, senders)
├── recording_saver.rs, incremental_saver.rs   audio file, checkpoints, metadata, transcripts
├── recording_preferences.rs   save folder, auto_save, preferred devices, macOS backend
├── import.rs, retranscription.rs   batch transcription of files
├── device_monitor.rs, playback_monitor.rs, device_detection.rs, permissions.rs
├── level_monitor.rs, simple_level_monitor.rs   settings level meters
├── ffmpeg.rs, ffmpeg_mixer.rs, encode.rs, decoder.rs   ffmpeg sidecar, RNNoise flag, encoding/decoding
├── async_logger.rs, batch_processor.rs   non-blocking logging, metrics batching
└── buffer_pool.rs, common.rs, constants.rs, diagnostics.rs, hardware_detector.rs, system_detector.rs, ...
```

Not compiled (do not edit): `core-old.rs`, `recording_saver_old.rs`, `recording_commands.rs.backup`,
`stt.rs`, `system_audio_stream.rs`, `system_audio_types.ts`.

## Debugging

- Verbose audio logs: `RUST_LOG=app_lib::audio=debug pnpm run tauri:dev` (from `frontend/`).
- Per-chunk metrics are batched (`AudioMetricsBatcher`); the pipeline logs a summary every 200
  chunks or 60 seconds.
- Watch for `recording-error` events in the UI console. (The UI also listens for
  `chunk-drop-warning`, but nothing in the live Rust code emits it; TD-23.)

## Changing the pipeline safely

- No blocking I/O, locks held across `.await`, or per-chunk `info!` logging in `pipeline.rs`,
  capture callbacks or the worker; use `perf_debug!`.
- Keep the 48 kHz contract: everything after capture assumes 48 kHz mono.
- Recording and transcription share the mixed stream; a change to mixing affects both.
- Test with: microphone only, system only, both at once, a device unplugged mid-recording, and a
  Bluetooth headset. Then run the manual smoke test from the root [AGENTS.md](../../AGENTS.md).
