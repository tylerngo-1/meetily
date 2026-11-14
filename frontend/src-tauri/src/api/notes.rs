//! Commands for meeting prep (type, context, series, participants) and note entries.
//! See docs/plans/meeting-prep-and-live-notes.md.
//!
//! Logs never include note text or context: they may end up in bug reports.

use log::{error as log_error, info as log_info};
use serde::Serialize;

use crate::database::repositories::meeting_notes::{MeetingNotes, MeetingNotesRepository};
use crate::database::repositories::meeting_prep::{MeetingPrep, MeetingPrepRepository, Person};
use crate::database::repositories::note_entries::{NoteEntriesRepository, NoteEntry, NoteEntryInput};
use crate::state::AppState;

fn not_found(meeting_id: &str) -> String {
    format!("No meeting found with id {}", meeting_id)
}

#[tauri::command]
pub async fn api_list_note_entries(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Vec<NoteEntry>, String> {
    NoteEntriesRepository::list_entries(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|e| {
            log_error!("Failed to load notes for meeting {}: {}", meeting_id, e);
            format!("Failed to load notes: {}", e)
        })
}

/// Replaces all entries of a meeting. Used to save the notes taken during recording.
#[tauri::command]
pub async fn api_save_note_entries(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    entries: Vec<NoteEntryInput>,
) -> Result<(), String> {
    let count = entries.len();
    match NoteEntriesRepository::replace_entries(state.db_manager.pool(), &meeting_id, entries).await {
        Ok(true) => {
            log_info!("Saved {} note entries for meeting {}", count, meeting_id);
            Ok(())
        }
        Ok(false) => Err(not_found(&meeting_id)),
        Err(e) => {
            log_error!("Failed to save note entries for meeting {}: {}", meeting_id, e);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn api_upsert_note_entry(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    entry: NoteEntryInput,
) -> Result<NoteEntry, String> {
    match NoteEntriesRepository::upsert_entry(state.db_manager.pool(), &meeting_id, entry).await {
        Ok(Some(saved)) => Ok(saved),
        Ok(None) => Err(format!(
            "This note doesn't belong to meeting {}, or the meeting no longer exists",
            meeting_id
        )),
        Err(e) => {
            log_error!("Failed to save a note entry for meeting {}: {}", meeting_id, e);
            Err(e)
        }
    }
}

/// Returns whether an entry was deleted.
#[tauri::command]
pub async fn api_delete_note_entry(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    entry_id: String,
) -> Result<bool, String> {
    NoteEntriesRepository::delete_entry(state.db_manager.pool(), &meeting_id, &entry_id)
        .await
        .map_err(|e| {
            log_error!("Failed to delete a note entry for meeting {}: {}", meeting_id, e);
            format!("Failed to delete note: {}", e)
        })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingPrepDetails {
    #[serde(flatten)]
    pub prep: MeetingPrep,
    pub participants: Vec<Person>,
}

#[tauri::command]
pub async fn api_get_meeting_prep(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<MeetingPrepDetails, String> {
    let pool = state.db_manager.pool();
    let load = |e: sqlx::Error| format!("Failed to load meeting details: {}", e);
    let prep = MeetingPrepRepository::get_prep(pool, &meeting_id)
        .await
        .map_err(load)?
        .ok_or_else(|| not_found(&meeting_id))?;
    let participants = MeetingPrepRepository::get_participants(pool, &meeting_id)
        .await
        .map_err(load)?;
    Ok(MeetingPrepDetails { prep, participants })
}

#[tauri::command]
pub async fn api_set_meeting_prep(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    prep: MeetingPrep,
) -> Result<(), String> {
    match MeetingPrepRepository::set_prep(state.db_manager.pool(), &meeting_id, prep).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(not_found(&meeting_id)),
        Err(e) => {
            log_error!("Failed to save prep for meeting {}: {}", meeting_id, e);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn api_set_meeting_participants(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    names: Vec<String>,
) -> Result<Vec<Person>, String> {
    MeetingPrepRepository::set_participants(state.db_manager.pool(), &meeting_id, names)
        .await?
        .ok_or_else(|| not_found(&meeting_id))
}

#[tauri::command]
pub async fn api_list_people(state: tauri::State<'_, AppState>) -> Result<Vec<Person>, String> {
    MeetingPrepRepository::list_people(state.db_manager.pool())
        .await
        .map_err(|e| format!("Failed to load people: {}", e))
}

/// The meeting's notes document, or `None` if it has no notes yet.
#[tauri::command]
pub async fn api_get_meeting_notes(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<MeetingNotes>, String> {
    MeetingNotesRepository::get_notes(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|e| {
            log_error!("Failed to load notes document for meeting {}: {}", meeting_id, e);
            format!("Failed to load notes: {}", e)
        })
}

#[tauri::command]
pub async fn api_save_meeting_notes(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    notes_markdown: String,
    notes_json: Option<String>,
) -> Result<(), String> {
    match MeetingNotesRepository::save_notes(
        state.db_manager.pool(),
        &meeting_id,
        &notes_markdown,
        notes_json.as_deref(),
    )
    .await
    {
        Ok(true) => {
            log_info!("Saved notes document for meeting {} ({} bytes)", meeting_id, notes_markdown.len());
            Ok(())
        }
        Ok(false) => Err(not_found(&meeting_id)),
        Err(e) => {
            log_error!("Failed to save notes document for meeting {}: {}", meeting_id, e);
            Err(e)
        }
    }
}
