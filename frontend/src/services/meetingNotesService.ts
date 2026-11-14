/**
 * Meeting notes and prep service
 *
 * Typed wrappers over the Rust commands in `src-tauri/src/api/notes.rs` and
 * `api_get_recording_offset`. See docs/plans/meeting-prep-and-live-notes.md.
 */

import { invoke } from '@tauri-apps/api/core';

export type NoteEntryKind = 'note' | 'bookmark' | 'agenda';
export type NoteTag = 'action' | 'decision' | 'question';

/** What the UI sends. `startMs` / `endMs` are on the recording clock. */
export interface NoteEntryInput {
  id: string;
  kind: NoteEntryKind;
  tag: NoteTag | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
  quotedText: string | null;
  done: boolean;
  position: number;
}

export interface NoteEntry extends NoteEntryInput {
  meetingId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingPrep {
  templateId: string | null;
  prepContext: string | null;
  seriesId: string | null;
}

export interface Person {
  id: string;
  name: string;
}

export interface MeetingPrepDetails extends MeetingPrep {
  participants: Person[];
}

export interface MeetingNotesRecord {
  notesMarkdown: string | null;
  notesJson: string | null;
  updatedAt: string;
}

export const meetingNotesService = {
  /** Position in the current recording in ms, or null when not recording. */
  getRecordingOffset(): Promise<number | null> {
    return invoke<number | null>('api_get_recording_offset');
  },

  listNoteEntries(meetingId: string): Promise<NoteEntry[]> {
    return invoke<NoteEntry[]>('api_list_note_entries', { meetingId });
  },

  /** Replaces every entry of the meeting. */
  saveNoteEntries(meetingId: string, entries: NoteEntryInput[]): Promise<void> {
    return invoke<void>('api_save_note_entries', { meetingId, entries });
  },

  upsertNoteEntry(meetingId: string, entry: NoteEntryInput): Promise<NoteEntry> {
    return invoke<NoteEntry>('api_upsert_note_entry', { meetingId, entry });
  },

  deleteNoteEntry(meetingId: string, entryId: string): Promise<boolean> {
    return invoke<boolean>('api_delete_note_entry', { meetingId, entryId });
  },

  getMeetingPrep(meetingId: string): Promise<MeetingPrepDetails> {
    return invoke<MeetingPrepDetails>('api_get_meeting_prep', { meetingId });
  },

  setMeetingPrep(meetingId: string, prep: MeetingPrep): Promise<void> {
    return invoke<void>('api_set_meeting_prep', { meetingId, prep });
  },

  setMeetingParticipants(meetingId: string, names: string[]): Promise<Person[]> {
    return invoke<Person[]>('api_set_meeting_participants', { meetingId, names });
  },

  getMeetingNotes(meetingId: string): Promise<MeetingNotesRecord | null> {
    return invoke<MeetingNotesRecord | null>('api_get_meeting_notes', { meetingId });
  },

  /** Creates or replaces the meeting's notes document. */
  saveMeetingNotes(meetingId: string, notesMarkdown: string, notesJson: string | null): Promise<void> {
    return invoke<void>('api_save_meeting_notes', { meetingId, notesMarkdown, notesJson });
  },

  listPeople(): Promise<Person[]> {
    return invoke<Person[]>('api_list_people');
  },
};
