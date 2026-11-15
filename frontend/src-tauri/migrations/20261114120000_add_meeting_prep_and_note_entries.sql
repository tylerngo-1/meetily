-- Meeting prep and live notes (docs/plans/meeting-prep-and-live-notes.md, section 4.2).
--
-- Note entries are anchored to the recording clock (start_ms / end_ms), never to
-- transcript rows: re-transcription replaces every transcript row with new ids.

CREATE TABLE IF NOT EXISTS meeting_note_entries (
    id          TEXT PRIMARY KEY,
    meeting_id  TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('note', 'bookmark', 'agenda')),
    tag         TEXT CHECK (tag IS NULL OR tag IN ('action', 'decision', 'question')),
    text        TEXT NOT NULL DEFAULT '',
    start_ms    INTEGER,
    end_ms      INTEGER,
    quoted_text TEXT,
    done        INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_entries_meeting
    ON meeting_note_entries(meeting_id, position);

ALTER TABLE meetings ADD COLUMN template_id TEXT;
ALTER TABLE meetings ADD COLUMN prep_context TEXT;
ALTER TABLE meetings ADD COLUMN series_id TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_series ON meetings(series_id);

CREATE TABLE IF NOT EXISTS people (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    name_normalized TEXT NOT NULL UNIQUE,
    email           TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_participants (
    meeting_id TEXT NOT NULL,
    person_id  TEXT NOT NULL,
    PRIMARY KEY (meeting_id, person_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_person
    ON meeting_participants(person_id);
