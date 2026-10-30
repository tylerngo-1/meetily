# Meetily - Frontend

The Meetily desktop app: a Next.js UI (`src/`) and a Rust/Tauri core (`src-tauri/`), built
together into one native app. There is no separate server, FastAPI service or whisper-server
process; recording, transcription, storage and summaries all run inside the app.

```
/frontend
├── src/          # Next.js UI (TypeScript)
├── src-tauri/    # Rust core: audio, transcription, database, summaries
├── tests/        # Frontend unit tests
├── public/       # Static assets
└── package.json
```

- Setup, build commands, GPU acceleration and troubleshooting: [docs/development/building.md](../docs/development/building.md)
- How the app works: [docs/architecture/overview.md](../docs/architecture/overview.md)
- Rules for changing the code: [AGENTS.md](../AGENTS.md), [src/AGENTS.md](src/AGENTS.md), [src-tauri/AGENTS.md](src-tauri/AGENTS.md)

Licensed under the MIT License; see [LICENSE.md](../LICENSE.md).
