# Meeting Summary Templates

This directory contains the built-in template definitions for meeting summary generation. They are
bundled with the app as resources (`templates/*.json` in `tauri.conf.json`). How templates are used
during summarization: [docs/architecture/summarization.md](../../../docs/architecture/summarization.md#templates).

## Available Templates

The file name (without `.json`) is the template id.

| Id | Name | Sections |
|---|---|---|
| `standard_meeting` | Standard Meeting Notes | Summary, Key Decisions, Action Items, Discussion Highlights |
| `daily_standup` | Daily Standup | Date, Attendees, Yesterday, Today, Blockers, Notes |
| `project_sync` | Project Sync / Status Update | Meeting Date & Time, Attendees, Milestones & Status, Progress Summary, Top Risks & Mitigations, Key Decisions, Action Items, Related Documents |
| `retrospective` | Retrospective (Agile) | Sprint, Attendance, Start Doing, Stop Doing, Continue Doing, Action Items, Notes & Votes |
| `sales_marketing_client_call` | Client / Sales Meeting | Meeting Metadata, Attendees, Client Goals & Success Criteria, Agreed Deliverables, Commercial Terms Discussed, Risks & Concerns, Next Steps |
| `psychatric_session` | Psychiatric Session Note (SOAP + AI Hybrid) | Session Metadata, AI Session Summary, Subjective (S), Objective (O), Assessment (A), Plan (P), Medications, Diagnoses (DSM/ICD), Safety & Risk Management, Next Appointment, Audit Trail |

`psychatric_session` keeps upstream's spelling: renaming the file would change the id.
`standard_meeting` and `daily_standup` are also compiled into the binary as a fallback
(`src/summary/templates/defaults.rs`).

## Template Structure

Each template JSON file follows this schema:

```json
{
  "name": "Template Name",
  "description": "Brief description of the template's purpose",
  "sections": [
    {
      "title": "Section Title",
      "instruction": "Instructions for the LLM on what to extract/include",
      "format": "paragraph|list|string",
      "item_format": "Optional: Markdown table format for list items"
    }
  ]
}
```

## Template Fields

### Root Level
- `name` (required, not empty): Display name for the template
- `description` (required, not empty): Brief explanation of the template's use case
- `sections` (required, at least one): Array of section definitions

### Section Object
- `title` (required, not empty): Section heading text
- `instruction` (required, not empty): LLM guidance for this section
- `format` (required): One of `"paragraph"`, `"list"`, or `"string"`
- `item_format` (optional): Markdown formatting hint for list items (e.g., table structure)
- `example_item_format` (optional): Alternative formatting hint, used only when `item_format` is absent

A template that breaks these rules is rejected with an error naming the section
(`Template::validate` in `src/summary/templates/types.rs`).

## Custom Templates

Users can add templates to a custom folder (`dirs::data_dir()/Meetily/templates/`):

- **macOS**: `~/Library/Application Support/Meetily/templates/`
- **Windows**: `%APPDATA%\Meetily\templates\`
- **Linux**: `~/.local/share/Meetily/templates/` (or `$XDG_DATA_HOME/Meetily/templates/`)

- A custom file with the same name as a built-in template overrides it; any other `.json` file there
  adds a new template.
- This folder is outside the app's data folder, so the dev app and the installed app share it (TD-15).
  The source comment in `loader.rs` still gives `~/.config/` for Linux (TD-14).

## Loading Order

`get_template(id)` uses the first match:

1. The custom folder above
2. The bundled resources (this directory, shipped with the app)
3. The built-in fallback compiled into the binary (`standard_meeting`, `daily_standup` only)

## Usage in Code

Templates are loaded with the `summary::templates` module (`src/summary/templates/`):

```rust
use crate::summary::templates;

// Get a specific template (custom → bundled → built-in)
let template = templates::get_template("daily_standup")?;

// All ids (built-in, bundled and custom)
let ids = templates::list_template_ids();

// (id, name, description) for each template
let available = templates::list_templates();

// Parse and validate template JSON
let custom_json = std::fs::read_to_string("custom.json")?;
let validated = templates::validate_and_parse_template(&custom_json)?;
```

The UI uses the Tauri commands `api_list_templates`, `api_get_template_details` and
`api_validate_template` (`src/summary/template_commands.rs`).

To add a built-in template, follow the checklist in
[docs/development/recipes.md](../../../docs/development/recipes.md#5-add-a-built-in-summary-template).
