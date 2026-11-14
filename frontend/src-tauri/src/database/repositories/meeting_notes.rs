//! The free-form notes document of a meeting (table `meeting_notes`, one row per meeting).
//!
//! `notes_json` is owned by the UI: the editor's blocks plus the recording-clock time of each
//! block (see `frontend/src/lib/notes-document.ts`). `notes_markdown` is a plain-text copy for
//! the summary and for copying. The core stores both as given.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// Generous: a long meeting's notes are tens of KB. This only stops runaway payloads.
pub const MAX_NOTES_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MeetingNotes {
    pub notes_markdown: Option<String>,
    pub notes_json: Option<String>,
    pub updated_at: String,
}

pub struct MeetingNotesRepository;

impl MeetingNotesRepository {
    pub async fn get_notes(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingNotes>, sqlx::Error> {
        sqlx::query_as::<_, MeetingNotes>(
            "SELECT notes_markdown, notes_json, updated_at FROM meeting_notes WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    /// Creates or replaces the notes of a meeting. Returns `Ok(false)` if the meeting does
    /// not exist.
    pub async fn save_notes(
        pool: &SqlitePool,
        meeting_id: &str,
        notes_markdown: &str,
        notes_json: Option<&str>,
    ) -> Result<bool, String> {
        let size = notes_markdown.len() + notes_json.map_or(0, str::len);
        if size > MAX_NOTES_BYTES {
            return Err("These notes are too large to save".to_string());
        }
        let db = |e: sqlx::Error| format!("Failed to save notes: {}", e);

        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
            .map_err(db)?;
        if exists.is_none() {
            return Ok(false);
        }

        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO meeting_notes (meeting_id, notes_markdown, notes_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(meeting_id) DO UPDATE SET
                notes_markdown = excluded.notes_markdown,
                notes_json = excluded.notes_json,
                updated_at = excluded.updated_at",
        )
        .bind(meeting_id)
        .bind(notes_markdown)
        .bind(notes_json)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(db)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::note_entries::tests::{insert_meeting, migrated_pool};

    #[tokio::test]
    async fn save_then_replace() {
        let pool = migrated_pool().await;
        insert_meeting(&pool, "m1").await;
        assert!(MeetingNotesRepository::get_notes(&pool, "m1").await.unwrap().is_none());

        assert!(MeetingNotesRepository::save_notes(&pool, "m1", "- first", Some("{\"v\":1}"))
            .await
            .unwrap());
        assert!(MeetingNotesRepository::save_notes(&pool, "m1", "- second", None)
            .await
            .unwrap());

        let notes = MeetingNotesRepository::get_notes(&pool, "m1").await.unwrap().unwrap();
        assert_eq!(notes.notes_markdown.as_deref(), Some("- second"));
        assert_eq!(notes.notes_json, None);
    }

    #[tokio::test]
    async fn unknown_meeting_and_oversized_notes_are_rejected() {
        let pool = migrated_pool().await;
        assert!(!MeetingNotesRepository::save_notes(&pool, "missing", "x", None).await.unwrap());

        insert_meeting(&pool, "m1").await;
        let huge = "x".repeat(MAX_NOTES_BYTES + 1);
        assert!(MeetingNotesRepository::save_notes(&pool, "m1", &huge, None).await.is_err());
    }
}
