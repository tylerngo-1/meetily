# Summarization

How a meeting transcript becomes a structured summary. Paths are relative to
`frontend/src-tauri/src/` unless they start with `frontend/`.

## Providers

| Provider (`LLMProvider`, `summary/llm_client.rs`) | UI id | Runs | Code |
|---|---|---|---|
| Built-in AI | `builtin-ai` | Locally, in the `llama-helper` sidecar | `summary/summary_engine/` |
| Ollama | `ollama` | Locally, in the user's Ollama server (default `http://localhost:11434`, configurable) | `ollama/` |
| Claude | `claude` | Anthropic API | `anthropic/` |
| Groq | `groq` | Groq API | `groq/` |
| OpenRouter | `openrouter` | OpenRouter API | `openrouter/` |
| OpenAI | `openai` | OpenAI API | `openai/` |
| Custom OpenAI-compatible | `custom-openai` | Any OpenAI-compatible endpoint (URL, key, max tokens, temperature, top-p) | `llm_client.rs` |

- Provider, model and API keys are saved in the SQLite `settings` table. Keys are stored as plain
  text (TD-24).
- Gemini has a `settings` column but no provider; it is not supported (TD-16).
- UI: `ModelSettingsModal.tsx`, `SummaryModelSettings.tsx`, `ConfigContext` (`modelConfig`).

## Flow

1. The meeting details page calls `api_process_transcript` (`summary/commands.rs`) with the
   transcript text, provider/model, template id and summary language. The UI starts it automatically
   after a recording (`source=recording`) or when the user clicks generate.
2. The command registers a cancellation token, spawns
   `SummaryService::process_transcript_background` (`summary/service.rs`) and returns immediately.
3. The background task:
   - picks a **chunk size** from the model's context window: Ollama via its `/api/show` metadata,
     Built-in AI from its model registry (both minus 300 tokens for the prompt), cloud providers
     effectively unlimited (single pass);
   - loads the **template** (`summary/templates/`) and the summary language;
   - calls `generate_meeting_summary` (`summary/processor.rs`), described below;
   - writes the meeting name extracted from the summary (unless the user set the title; see below),
     **then** marks the process `completed` in `summary_processes`, or `failed` / `cancelled`.
4. The UI (`hooks/meeting-details/useSummaryGeneration.ts`) polls `api_get_summary` until the
   status is final, then renders the Markdown in BlockNote. `api_cancel_summary` cancels a running job.

If a caller omits the template id, Rust falls back to `daily_standup`; the UI normally passes the
selected template (default `standard_meeting`).

## Two-pass generation (`summary/processor.rs`)

**Pass 1 always produces an English report:**
- Short transcript: one call builds the final report from the template.
- Long transcript (above the chunk size): `chunk_text` splits it (chunk size − 300 tokens, 100-token
  overlap) → each chunk is summarized → the chunk summaries are combined → the final report is built
  from the template.

**Pass 2 handles the language** (`FinalLanguageAction`):
- target English → return pass 1;
- another language → translate the Markdown (names, code, paths, URLs and numbers stay unchanged);
- unknown → normalize to English.

The English pass-1 result is **cached** in the meeting's `summary_processes` row, keyed by the
transcript, custom prompt, template (id and content fingerprint), chunk size, provider, model and
Ollama endpoint (`build_summary_cache_source` in `service.rs`). Switching only the summary language
re-runs pass 2 instead of the whole summary; changing anything in the key regenerates pass 1.

Language handling: the summary language can be set per meeting (`api_get/save_meeting_summary_language`);
otherwise it is detected from the transcript (`summary/language_detection.rs`,
`api_detect_transcript_summary_language`).

Prompt safety: transcripts are wrapped in tags (`<transcript_chunk>`, `<summaries>`, ...) and the
system prompt tells the model to ignore any instructions inside them.

## Built-in AI (`summary/summary_engine/`)

- Runs `llama-helper` (the workspace crate in `llama-helper/`, using `llama-cpp-2`) as a sidecar
  process and talks to it over **stdin/stdout** (`sidecar.rs`). On Unix it is started under `nice`.
- The process is kept alive between requests and stopped after **5 minutes idle**
  (`DEFAULT_IDLE_TIMEOUT_SECS`; override with the `LLAMA_IDLE_TIMEOUT` environment variable).
- Models (`models.rs`), GGUF Q4_K_M from Hugging Face, 32k context:
  `qwen3.5:2b`, `qwen3.5:4b`, `gemma3:4b`, `gemma3:1b`.
- Stored in `<app data>/models/summary/`; downloaded by `model_manager.rs` with progress events
  (`builtin-ai-download-progress`).
- GPU: the sidecar is built with `metal`, `cuda` or `vulkan` (no CoreML) by `dev-gpu.sh` /
  `build-gpu.sh`; see the root [AGENTS.md](../../AGENTS.md) for building it by hand.

## Templates

- Built-in templates are JSON files in `frontend/src-tauri/templates/`, bundled as app resources
  (`templates/*.json` in `tauri.conf.json`): `standard_meeting`, `daily_standup`, `project_sync`,
  `retrospective`, `sales_marketing_client_call`, `psychatric_session`. Only `standard_meeting` and
  `daily_standup` are also compiled into the binary as a fallback (`summary/templates/defaults.rs`).
- Users can add or override templates in a custom folder. Format, fields and locations:
  [frontend/src-tauri/templates/README.md](../../frontend/src-tauri/templates/README.md).
- Commands: `api_list_templates`, `api_get_template_details`, `api_validate_template`
  (`summary/template_commands.rs`). UI: `hooks/meeting-details/useTemplates.ts`.

## Meeting names

The final report starts with a `#` heading that is used as the meeting name
(`extract_meeting_name_from_markdown`). It is written with `update_meeting_name`, which **skips
meetings whose title the user set** (`meetings.title_user_set`). User renames use
`update_meeting_title`. The name is written before the process is marked `completed`, so the UI
never reads a stale title.

## Storage

`summary_processes` (one row per meeting): `status`, `result` (JSON with the Markdown), `error`,
`start_time` / `end_time`, `chunk_count`, `processing_time`, `metadata`. Saving an edited summary
uses `api_save_meeting_summary`. See [data-storage.md](data-storage.md).

## Changing summarization safely

- Keep the "write name, then mark completed" order in `service.rs`.
- Prompts are spread across `processor.rs`; change them together and test with a short and a long
  (chunked) transcript, in English and another language, with a local and a cloud provider.
- Never send transcript text anywhere except the provider the user selected (root `AGENTS.md`, rule 8).
