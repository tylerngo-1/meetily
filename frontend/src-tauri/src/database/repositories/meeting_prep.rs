//! Information entered before or around a meeting: meeting type (summary template),
//! context for the summary, series, and participants.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqlitePool};
use uuid::Uuid;

pub const MAX_PREP_CONTEXT_CHARS: usize = 20_000;
pub const MAX_PARTICIPANTS: usize = 50;
pub const MAX_NAME_CHARS: usize = 100;

const PARTICIPANTS_QUERY: &str = "SELECT p.id, p.name FROM meeting_participants mp
     JOIN people p ON p.id = mp.person_id
     WHERE mp.meeting_id = ?
     ORDER BY p.name COLLATE NOCASE";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MeetingPrep {
    pub template_id: Option<String>,
    pub prep_context: Option<String>,
    pub series_id: Option<String>,
}

impl MeetingPrep {
    /// Blank strings become `None`; `prep_context` is length-checked.
    pub fn validate(self) -> Result<Self, String> {
        let blank_to_none = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
        let prep = MeetingPrep {
            template_id: blank_to_none(self.template_id).map(|s| s.trim().to_string()),
            prep_context: blank_to_none(self.prep_context),
            series_id: blank_to_none(self.series_id).map(|s| s.trim().to_string()),
        };
        if prep
            .prep_context
            .as_ref()
            .is_some_and(|c| c.chars().count() > MAX_PREP_CONTEXT_CHARS)
        {
            return Err(format!(
                "Context can be at most {} characters long",
                MAX_PREP_CONTEXT_CHARS
            ));
        }
        Ok(prep)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Person {
    pub id: String,
    pub name: String,
}

/// Trims names, drops empty ones and case-insensitive duplicates (first spelling wins),
/// and enforces the limits.
pub fn normalize_participant_names(names: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for name in names {
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if name.is_empty() {
            continue;
        }
        if name.chars().count() > MAX_NAME_CHARS {
            return Err(format!(
                "A name can be at most {} characters long",
                MAX_NAME_CHARS
            ));
        }
        if seen.insert(name.to_lowercase()) {
            result.push(name);
        }
    }
    if result.len() > MAX_PARTICIPANTS {
        return Err(format!(
            "A meeting can have at most {} participants",
            MAX_PARTICIPANTS
        ));
    }
    Ok(result)
}

pub struct MeetingPrepRepository;

impl MeetingPrepRepository {
    /// `Ok(None)` if the meeting does not exist.
    pub async fn get_prep(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingPrep>, sqlx::Error> {
        sqlx::query_as::<_, MeetingPrep>(
            "SELECT template_id, prep_context, series_id FROM meetings WHERE id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    /// Sets all three fields (a `None` clears the field). Returns whether the meeting exists.
    pub async fn set_prep(
        pool: &SqlitePool,
        meeting_id: &str,
        prep: MeetingPrep,
    ) -> Result<bool, String> {
        let prep = prep.validate()?;
        let result = sqlx::query(
            "UPDATE meetings SET template_id = ?, prep_context = ?, series_id = ? WHERE id = ?",
        )
        .bind(&prep.template_id)
        .bind(&prep.prep_context)
        .bind(&prep.series_id)
        .bind(meeting_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save meeting details: {}", e))?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn get_participants(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<Person>, sqlx::Error> {
        sqlx::query_as::<_, Person>(PARTICIPANTS_QUERY)
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    /// Replaces the participant set of a meeting. People are matched case-insensitively and
    /// created when new. Returns `Ok(None)` if the meeting does not exist.
    pub async fn set_participants(
        pool: &SqlitePool,
        meeting_id: &str,
        names: Vec<String>,
    ) -> Result<Option<Vec<Person>>, String> {
        let names = normalize_participant_names(names)?;
        let db = |e: sqlx::Error| format!("Failed to save participants: {}", e);
        let mut conn = pool.acquire().await.map_err(db)?;
        let mut tx = conn.begin().await.map_err(db)?;

        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
        if exists.is_none() {
            return Ok(None);
        }

        sqlx::query("DELETE FROM meeting_participants WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;

        let now = Utc::now().to_rfc3339();
        for name in &names {
            sqlx::query(
                "INSERT INTO people (id, name, name_normalized, created_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(name_normalized) DO NOTHING",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(name)
            .bind(name.to_lowercase())
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(db)?;

            sqlx::query(
                "INSERT OR IGNORE INTO meeting_participants (meeting_id, person_id)
                 SELECT ?, id FROM people WHERE name_normalized = ?",
            )
            .bind(meeting_id)
            .bind(name.to_lowercase())
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        }

        // Read back inside the transaction: re-acquiring from the pool while this
        // connection is still held can exhaust a small pool.
        let participants = sqlx::query_as::<_, Person>(PARTICIPANTS_QUERY)
            .bind(meeting_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(Some(participants))
    }

    /// Everyone who has been in a meeting, most recently seen first, for autocomplete.
    pub async fn list_people(pool: &SqlitePool) -> Result<Vec<Person>, sqlx::Error> {
        sqlx::query_as::<_, Person>(
            "SELECT p.id, p.name FROM people p
             LEFT JOIN meeting_participants mp ON mp.person_id = p.id
             LEFT JOIN meetings m ON m.id = mp.meeting_id
             GROUP BY p.id
             ORDER BY MAX(m.created_at) DESC, p.name COLLATE NOCASE",
        )
        .fetch_all(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::note_entries::tests::{insert_meeting, migrated_pool};

    #[test]
    fn participant_names_are_normalized() {
        let names = normalize_participant_names(vec![
            "  An ".into(),
            "an".into(),
            "".into(),
            "Bình   Trần".into(),
        ])
        .unwrap();
        assert_eq!(names, ["An", "Bình Trần"]);
        assert!(normalize_participant_names(vec!["x".repeat(MAX_NAME_CHARS + 1)]).is_err());
        let too_many = (0..=MAX_PARTICIPANTS).map(|i| format!("p{}", i)).collect();
        assert!(normalize_participant_names(too_many).is_err());
    }

    #[tokio::test]
    async fn prep_round_trips_and_blank_clears() {
        let pool = migrated_pool().await;
        insert_meeting(&pool, "m1").await;

        let prep = MeetingPrep {
            template_id: Some("daily_standup".into()),
            prep_context: Some("Terms: PDF export, VN fonts".into()),
            series_id: Some("s1".into()),
        };
        assert!(MeetingPrepRepository::set_prep(&pool, "m1", prep.clone()).await.unwrap());
        assert_eq!(MeetingPrepRepository::get_prep(&pool, "m1").await.unwrap(), Some(prep));

        let cleared = MeetingPrep { prep_context: Some("  ".into()), ..Default::default() };
        MeetingPrepRepository::set_prep(&pool, "m1", cleared).await.unwrap();
        assert_eq!(
            MeetingPrepRepository::get_prep(&pool, "m1").await.unwrap(),
            Some(MeetingPrep::default())
        );

        assert!(!MeetingPrepRepository::set_prep(&pool, "missing", MeetingPrep::default())
            .await
            .unwrap());
        assert!(MeetingPrepRepository::get_prep(&pool, "missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn participants_are_shared_across_meetings_and_replaced() {
        let pool = migrated_pool().await;
        insert_meeting(&pool, "m1").await;
        insert_meeting(&pool, "m2").await;

        MeetingPrepRepository::set_participants(&pool, "m1", vec!["An".into(), "Bình".into()])
            .await
            .unwrap();
        let m2 = MeetingPrepRepository::set_participants(&pool, "m2", vec!["an".into()])
            .await
            .unwrap()
            .unwrap();
        // "an" resolves to the existing person "An".
        assert_eq!(m2.len(), 1);
        assert_eq!(m2[0].name, "An");
        assert_eq!(MeetingPrepRepository::list_people(&pool).await.unwrap().len(), 2);

        let m1 = MeetingPrepRepository::set_participants(&pool, "m1", vec!["Chi".into()])
            .await
            .unwrap()
            .unwrap();
        assert_eq!(m1.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Chi"]);

        assert!(MeetingPrepRepository::set_participants(&pool, "missing", vec!["An".into()])
            .await
            .unwrap()
            .is_none());
    }
}
