//! The free-form notes document of a meeting (table `meeting_notes`, one row per meeting).
//!
//! `notes_json` is owned by the UI: the editor's blocks plus the recording-clock time of each
//! bookmark (see `frontend/src/lib/notes-document.ts`). `notes_markdown` is a plain-text copy
//! for search, the summary and copying. The core stores both as given.

use super::search_snippet::match_snippet;
use crate::api::TranscriptSearchResult;
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

    /// Ids of meetings whose notes have any text, for the "has notes" mark in the meeting list.
    pub async fn meeting_ids_with_notes(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT meeting_id FROM meeting_notes
             WHERE notes_markdown IS NOT NULL
               AND TRIM(notes_markdown, ' ' || char(9) || char(10) || char(13)) <> ''",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(|(id,)| id).collect())
    }

    /// Meetings whose notes contain `query` (case-insensitive for ASCII, like transcript
    /// search), with a snippet around the match.
    pub async fn search_notes(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, sqlx::Error> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = format!(
            "%{}%",
            query.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        );
        let rows: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT m.id, m.title, n.notes_markdown, n.updated_at
             FROM meeting_notes n
             JOIN meetings m ON m.id = n.meeting_id
             WHERE LOWER(n.notes_markdown) LIKE ? ESCAPE '\\'
             ORDER BY n.updated_at DESC",
        )
        .bind(pattern)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, title, markdown, updated_at)| TranscriptSearchResult {
                id,
                title,
                match_context: match_snippet(&markdown, query, 60),
                timestamp: updated_at,
            })
            .collect())
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

    #[tokio::test]
    async fn lists_and_searches_meetings_with_notes() {
        let pool = migrated_pool().await;
        insert_meeting(&pool, "m1").await;
        insert_meeting(&pool, "m2").await;
        insert_meeting(&pool, "m3").await;
        MeetingNotesRepository::save_notes(&pool, "m1", "- Chốt phạm vi PDF export", None).await.unwrap();
        MeetingNotesRepository::save_notes(&pool, "m2", "  \n ", None).await.unwrap();

        let ids = MeetingNotesRepository::meeting_ids_with_notes(&pool).await.unwrap();
        assert_eq!(ids, vec!["m1".to_string()]);

        let hits = MeetingNotesRepository::search_notes(&pool, "pdf").await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "m1");
        assert!(hits[0].match_context.contains("PDF export"));
        // LIKE wildcards in the query are literal.
        assert!(MeetingNotesRepository::search_notes(&pool, "%").await.unwrap().is_empty());
        assert!(MeetingNotesRepository::search_notes(&pool, " ").await.unwrap().is_empty());
    }
}
