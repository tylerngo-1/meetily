-- Migration: Track whether the meeting title was set by the user
-- When set, automatic renames (e.g. the AI-extracted name after summary generation)
-- must not overwrite the user's title.

ALTER TABLE meetings ADD COLUMN title_user_set INTEGER NOT NULL DEFAULT 0;
