# Documentation

Start with the root [AGENTS.md](../AGENTS.md): it covers the rules, commands and checks that apply
to every change, for people and coding agents alike. The folder-level
[frontend/src-tauri/AGENTS.md](../frontend/src-tauri/AGENTS.md) and
[frontend/src/AGENTS.md](../frontend/src/AGENTS.md) add what applies to the Rust core and the UI.

## Architecture: how the app works

| Doc | Covers |
|---|---|
| [overview.md](architecture/overview.md) | Components, processes, how the UI and the Rust core talk, life of a meeting |
| [audio-pipeline.md](architecture/audio-pipeline.md) | Capture, mixing, VAD, recording files |
| [transcription.md](architecture/transcription.md) | Whisper and Parakeet, models, import and re-transcription |
| [summarization.md](architecture/summarization.md) | Providers, two-pass generation, templates, Built-in AI |
| [data-storage.md](architecture/data-storage.md) | Data locations, database tables, migrations, legacy import |

## Development: how to work on it

| Doc | Covers |
|---|---|
| [building.md](development/building.md) | Prerequisites, first build, GPU acceleration, production builds, build scripts |
| [testing.md](development/testing.md) | Which checks to run, tests, smoke test, test data, notifications, debugging |
| [logging.md](development/logging.md) | How logging works today and the rules for adding logs |
| [recipes.md](development/recipes.md) | Checklists for common changes (commands, migrations, settings, providers, ...) |
| [local-workflow.md](development/local-workflow.md) | Branches, dev app vs daily app, installing, rollback, upstream sync |
| [ci-release.md](development/ci-release.md) | GitHub workflows, releases, secrets, Windows portability rules |
| [upstream-map.md](development/upstream-map.md) | Where upstream's docs live in this fork, for syncs |

## Plans

| Doc | Status |
|---|---|
| [tech-debt.md](plans/tech-debt.md) | Living list of known problems (TD-xx), referenced throughout the docs |
| [ux-improvement.md](plans/ux-improvement.md) | Recording and meeting organization; some items shipped |
| [speaker-diarization.md](plans/speaker-diarization.md) | Proposal, no code |
| [docs-restructure.md](plans/docs-restructure.md) | How these docs were reorganized |

Each plan starts with a status line; check it before implementing anything from a plan.

## Elsewhere

- [frontend/src-tauri/templates/README.md](../frontend/src-tauri/templates/README.md): summary template format and the built-in templates
- [README.md](../README.md): upstream's product overview
- `images/`: screenshots, demos and diagrams used by the READMEs
