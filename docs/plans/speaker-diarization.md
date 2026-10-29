# Speaker Diarization: Implementation Plan

Status: **Proposal / research complete, no code written**
Date: 2026-10-28

Goal: label each transcript segment with *who* spoke ("Speaker 1", "Speaker 2", ...), fully on-device, with renamable and mergeable labels. This mirrors what the commercial Meetily Pro page describes (https://meetily.ai/speaker-diarization): on-device, no voiceprint enrolment, live labels during recording plus labels on imported / re-transcribed audio.

> The Pro page does not name its model or algorithm, so this plan is an independent design, not a reimplementation.

---

## 1. Where we are today

| Area | Current state | Relevance |
|---|---|---|
| ONNX Runtime | `ort = 2.0.0-rc.10` (`Cargo.toml`), `load-dynamic` on Windows/Linux; used by Parakeet and Silero VAD | Diarization models can reuse the same runtime |
| VAD | `audio/vad.rs`, Silero at 16 kHz, 30 ms frames, returns `SpeechSegment` with start/end ms | Natural unit for embedding extraction |
| Audio streams | Mic and system audio captured separately, then mixed for the recording | Strong prior: mic = local user, system = remote participants |
| `transcripts.speaker` column | Added by `20251110000001_add_speaker_field.sql` (comment says `mic`/`system`) but **never written**: the `INSERT` in `database/repositories/transcript.rs` omits it and the `Transcript` model has no such field | Free to redesign; no legacy data to preserve |
| Timestamps | `audio_start_time` / `audio_end_time` / `duration` per transcript row | Enough to join diarization turns to segments |
| Whisper word timing | `whisper_engine.rs:581,698` sets `set_no_timestamps(true)` and `set_token_timestamps(true)` | Token times need verification before relying on them (see 5.3) |
| Parakeet word timing | `parakeet_engine/model.rs` returns per-token `timestamps` | Word-level alignment is straightforward |
| Batch paths | `audio/import.rs`, `audio/retranscription.rs` (VAD with 2000 ms redemption) | Best place for the MVP |
| Licensing code | Migration `20251105120000_add_pro_license_custom_openai.sql` exists | A product decision is needed on whether this feature is gated (see section 9) |

---

## 2. Options evaluated

Research was done against current sources (see section 10). "Fit" is relative to our constraints: Rust core, existing `ort` rc.10, MIT-licensed app, three desktop platforms.

| Option | License | ONNX / runtime fit | Streaming | Accuracy (DER, no collar) | Verdict |
|---|---|---|---|---|---|
| **DIY**: pyannote segmentation-3.0 + speaker embedding + our own clustering, on existing `ort` | seg-3.0 MIT; WeSpeaker ResNet34-LM CC-BY-4.0; TitaNet/3D-Speaker Apache/CC-BY | Native fit, no new runtime | Offline, semi-online with our own code | pyannote 3.1 reference: AMI-IHM 18.8, AMI-SDM 22.7, VoxConverse 11.2 | **Primary** |
| `pyannote-rs` 0.3.4 | MIT | Same `ort` rc.10 + `ndarray` | Offline | Weaker: greedy cosine-threshold clustering only | Use as reference / vendor base |
| `sherpa-onnx` crate 2.0.1 | Apache-2.0 | **Bundles its own ONNX Runtime**; two copies in one process risk symbol/version clashes (`shared` feature mitigates, needs per-platform testing) | Offline only | RTF 0.11 to 0.30 on a 57 s clip (hardware unstated) | Second fallback |
| `polyvoice` 1.0.0 | MIT code and weights, ungated | No ONNX Runtime (own kernels) | Batch only | VoxConverse-test 13.3 (pyannote 3.1: 11.3), AMI-test 24.2 | **Fallback** for offline; README still says "beta", single maintainer |
| `speakrs` 0.7.0 | Unstated for code and weights | Needs `ort` rc.13 (conflicts) | Offline | VoxConverse-dev 7.1 | Not usable until `ort` upgrade and license clarified |
| NVIDIA Streaming Sortformer 4spk v2/v2.1 | v2.1: NVIDIA Open Model License; v2: **unverified** | Only unofficial ONNX exports, ~470 MB fp32 | Native streaming | AMI-IHM 16.7, AMI-SDM 20.6 at ~1 s latency | Max 4 speakers + size: optional experimental live engine only |
| tinydiarize | n/a | whisper.cpp fork | n/a | Marks turns only, English `small.en` only, project inactive | Rejected |
| Rev `reverb-diarization-v1` | **Non-commercial** | n/a | n/a | n/a | Rejected |

Licensing gotchas that drive the choices:
- The official Hugging Face `pyannote/*` repos are **gated** (token + terms). The sherpa-onnx GitHub-release mirrors of seg-3.0 are ungated, so the app can download them without a user token.
- CC-BY-4.0 weights (WeSpeaker, community-1) only require attribution, which we add to the About screen and `THIRD_PARTY_NOTICES`.

---

## 3. Recommended architecture

### 3.1 Principle: use the two streams as a prior

- **Mic stream** → label `Me` (channel `mic`). Optional setting "Several people share my microphone" to also diarize it.
- **System stream** → diarize. This is where remote participants are, and it removes the hardest overlap case (local user talking over remote speakers).

### 3.2 Pipeline

```
VAD SpeechSegment (system stream, 16 kHz)
        │
        ▼
 [segmenter]  seg-3.0, 10 s window, ≤3 speakers/window, ≤2 overlapped
        │      (only for long segments, to split speaker changes inside a segment)
        ▼
 [embedder]   Kaldi fbank (knf-rs) → TitaNet-small or WeSpeaker ResNet34 (ONNX via ort)
        │
        ▼
 [clusterer]  offline: agglomerative (AHC) over all embeddings
              live:    online centroid assignment (cosine) + periodic re-cluster
        │
        ▼
 DiarTurn { start, end, speaker_id }  ──►  aligner  ──►  transcript rows with speaker_id
```

### 3.3 New module layout

```
frontend/src-tauri/src/diarization/
├── mod.rs            # public API, DiarizationEngine, config
├── segmenter.rs      # pyannote seg-3.0 ONNX session + powerset decode
├── embedder.rs       # fbank features + embedding ONNX session
├── cluster.rs        # AHC (offline), OnlineClusterer (live), merge/relabel
├── aligner.rs        # join turns to transcript segments/words
├── model_manager.rs  # download, SHA-256 verify, status (mirrors whisper/parakeet managers)
└── commands.rs       # Tauri commands + events
```

Reuse the existing `ort` environment; do not introduce a second ONNX Runtime. Start from `pyannote-rs` (MIT, identical `ort`/`ndarray` versions) for the seg + embedding plumbing, and write the clustering ourselves.

### 3.4 Data model

New migration (do not repurpose the existing `speaker` column; keep it as the *channel*):

```sql
ALTER TABLE transcripts ADD COLUMN speaker_id TEXT;   -- stable per meeting, e.g. "spk_1"

CREATE TABLE IF NOT EXISTS meeting_speakers (
    meeting_id   TEXT NOT NULL,
    speaker_id   TEXT NOT NULL,
    display_name TEXT,            -- NULL until the user renames; UI shows "Speaker N"
    color        TEXT,
    centroid     BLOB,            -- running mean embedding, used for live assignment/relabel
    PRIMARY KEY (meeting_id, speaker_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

- Also fix the repository `INSERT` and the `Transcript` model so the existing `speaker` (channel) is actually persisted.
- Rename = `UPDATE meeting_speakers SET display_name`. Merge = re-point `transcripts.speaker_id` and delete the source row. One rename updates the whole transcript because rows only reference `speaker_id`.
- **No cross-meeting voiceprints.** Centroids are kept per meeting only (matches "no enrolment" and the privacy stance). Cross-meeting speaker memory is an explicit non-goal for v1.

### 3.5 Tauri surface

Commands (names indicative):
`diarization_get_model_status`, `diarization_download_models`, `diarization_run_for_meeting(meeting_id)`, `diarization_rename_speaker`, `diarization_merge_speakers`, `diarization_get_speakers(meeting_id)`.

Events: `diarization-progress`, `diarization-model-download-progress`, `speaker-relabel` (live mode; carries merged/split mappings so the UI can update past rows). `TranscriptUpdate` gains an optional `speaker_id`.

### 3.6 Frontend

- Settings: "Speaker identification" toggle + model download card (reuse the pattern in `BuiltInModelManager.tsx`).
- Meeting transcript view: speaker chip/color per row, click to rename, "merge with..." action, collapse consecutive same-speaker rows.
- Import / re-transcribe dialogs: "Identify speakers" checkbox.
- Summaries: pass speaker-labelled transcript text to the prompt so the summary can attribute action items.

---

## 4. Live vs post-hoc strategy

**Live (Phase 3):**
1. For each system-stream VAD segment of at least ~1.5 s, compute one embedding (~10 to 30 ms CPU).
2. Compare with running centroids by cosine similarity (starting threshold ~0.5 to 0.6, to be tuned); assign to the nearest or open a new cluster.
3. Segments under ~1 s: mark pending and inherit the neighbour's label once resolved.
4. Every N minutes, re-cluster all stored embeddings with AHC and emit `speaker-relabel` for any merges/splits.

**After stop (Phase 2):** always run a full offline pass (seg-3.0 + AHC) over the saved audio and replace live labels. Live labels are provisional; the final pass is the source of truth.

UX decision needed: whether labels visibly changing on past rows is acceptable (open question 5).

---

## 5. Aligning diarization with transcripts

### 5.1 Preferred: word-level join
1. For each word, take its midpoint time = segment `audio_start_time` + token offset.
2. Assign the word to the diarization turn with maximum overlap.
3. Split the transcript row where the speaker changes, provided the new run is at least ~0.5 s or 2 words; otherwise absorb into the neighbour.

### 5.2 Fallback: split audio first
Cut VAD chunks at diarization boundaries, then transcribe each piece. Simpler and robust for import/re-transcribe, at some cost in language-model context.

### 5.3 Engine specifics
- **Parakeet:** token `timestamps` already available. Use 5.1.
- **Whisper:** the code sets `no_timestamps(true)` *and* `token_timestamps(true)`. Before using 5.1, test whether token `t0/t1` are actually populated and accurate under this combination. If not, either enable DTW token timestamps or use 5.2. This must be spiked in Phase 0 because the comment says `no_timestamps` exists to prevent segment skipping.

---

## 6. Models and download UX

- One "Speaker identification" pack: seg-3.0 int8 (~1.5 MB) + one embedding model (~25 to 40 MB, **size estimated, verify**).
- Reuse the Whisper/Parakeet download manager conventions: progress events, resumable download, SHA-256 verification, stored under the existing models directory (`~/Library/Application Support/Meetily/models/` on macOS).
- Default embedding model: decide in Phase 0 by benchmark. TitaNet-small is English-trained; WeSpeaker ResNet34 / CAM++ are better candidates for multilingual use (open question 3).
- Add attribution for CC-BY weights to the About screen.

---

## 7. Resource budget (targets, to be measured)

| Metric | Target |
|---|---|
| Extra RAM | < 100 MB with models loaded |
| Live CPU overhead | < 3% (embedding per segment only) |
| Offline speed | 1 h audio in ~1 to 3 min on CPU |
| Disk | < 50 MB for the model pack |

The agent's figures come from published benchmarks on other hardware; treat them as hypotheses until measured on Apple Silicon, Intel Mac, and a mid-range Windows laptop.

---

## 8. Phased rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Spike (1 to 2 wk)** | Standalone binary/test: run seg-3.0 + 2 candidate embedders + AHC on ~10 real system-audio recordings and an AMI-SDM subset; test Whisper token timestamps; test `ort` rc.10 loading of the models on all 3 OSes | Pick embedder; measure DER and RTF; go/no-go |
| **1. MVP: offline on import/re-transcribe** | `diarization/` module, model manager, migration, `speaker_id`, rename/merge UI, system stream only | Labels on imported audio, rename/merge works, persisted |
| **2. Post-recording pass** | Auto-run on stop; replace provisional labels | No UI blocking; cancellable like retranscription |
| **3. Live** | Online clustering, `speaker-relabel` event, pending state | Latency < 1 segment; stable labels on a 30 min meeting |
| **4. Optional** | VBx/PLDA clustering, overlap-aware output, Sortformer experimental engine, diarizing the mic stream | Driven by Phase 3 feedback |

---

## 9. Risks and open questions

**Risks**
- Threshold tuning differs by language, codec and platform (Zoom/Teams compression vs local files).
- One person split into two clusters (noise/channel change). Mitigated by the merge action.
- Overlapping speech collapses to one speaker per segment in MVP.
- Echo of remote audio in the mic could pollute `Me`; verify existing mitigations.
- ONNX Runtime clashes if `sherpa-onnx` is ever added; avoid unless tested.
- Single-maintainer crates (`pyannote-rs`, `polyvoice`) may stall; vendor rather than depend where possible.
- Hugging Face gating: use ungated mirrors and verify redistribution terms before shipping.

**Open questions (need a human decision)**
1. Is CC-BY attribution acceptable for shipped weights?
2. Diarize the mic stream too (several people at one laptop)? Proposed: optional setting, off by default.
3. Target languages and typical speaker counts? Drives embedder choice.
4. Whisper: DTW/token timestamps or split-audio-first (5.2)?
5. Is live relabelling of past rows acceptable UX?
6. Confirm cross-meeting speaker memory is out of scope for privacy reasons.
7. Upgrade `ort` to rc.13 to unlock `speakrs`/community-1 accuracy, only if its license is confirmed?
8. Evaluation set: internal real Zoom/Teams system-audio recordings + AMI-SDM subset?
9. **Product:** this project is MIT, but the hosted Pro edition sells diarization as a paid feature, and the repo contains Pro-license plumbing. Should this ship in the open-source build ungated, or behind the license check? Not a technical question; needs the maintainers' call.

**Unverified facts from research**
- Sortformer **v2** (non-.1) license (one third-party note says CC-BY-4.0).
- Exact embedding model file sizes.
- Hardware used for the sherpa-onnx RTF numbers.
- `speakrs` code/weights license.

---

## 10. Sources

- Meetily Pro page: https://meetily.ai/speaker-diarization
- sherpa-onnx diarization docs and models: https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html , https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html
- sherpa-onnx Rust crate: https://docs.rs/sherpa-onnx
- pyannote segmentation-3.0: https://huggingface.co/pyannote/segmentation-3.0
- pyannote community-1: https://huggingface.co/pyannote/speaker-diarization-community-1
- WeSpeaker ResNet34-LM: https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM
- pyannote-rs: https://github.com/thewh1teagle/pyannote-rs
- speakrs: https://docs.rs/crate/speakrs/latest
- polyvoice: https://docs.rs/crate/polyvoice/latest
- NVIDIA Streaming Sortformer v2.1: https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1 , paper https://arxiv.org/html/2507.18446v1
- tinydiarize: https://github.com/akashmjn/tinydiarize
