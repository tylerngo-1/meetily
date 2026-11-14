'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useMeetingDraft } from '@/contexts/MeetingDraftContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { meetingNotesService, type NoteEntryInput, type NoteTag } from '@/services/meetingNotesService';
import {
  agendaCheckRange,
  bookmarkAnchor,
  noteAnchor,
  parseNoteInput,
  quoteForRange,
  resolveSegmentMarks,
  toAnchorSegments,
  type TimeRange,
} from '@/lib/note-anchors';

function newEntryId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Notes taken during a recording. Entries live in the meeting draft (MeetingDraftContext) and
 * are saved with the meeting after stop. Times come from the core's recording clock.
 */
export function useLiveNotes() {
  const { draft, updateDraft } = useMeetingDraft();
  const { transcripts } = useTranscripts();
  const { activeDuration } = useRecordingState();

  const activeDurationRef = useRef(activeDuration);
  activeDurationRef.current = activeDuration;

  const anchorSegments = useMemo(
    () =>
      toAnchorSegments(
        transcripts.map((t) => ({
          id: t.id,
          timestamp: t.audio_start_time ?? 0,
          endTime: t.audio_end_time,
          text: t.text,
        })),
      ),
    [transcripts],
  );
  const anchorSegmentsRef = useRef(anchorSegments);
  anchorSegmentsRef.current = anchorSegments;

  const entries = draft.entries;
  const agenda = useMemo(() => entries.filter((e) => e.kind === 'agenda'), [entries]);
  const notes = useMemo(() => entries.filter((e) => e.kind !== 'agenda'), [entries]);
  const segmentMarks = useMemo(() => resolveSegmentMarks(entries, anchorSegments), [entries, anchorSegments]);

  /** Current position in the recording. Falls back to the polled duration if the call fails. */
  const getOffsetMs = useCallback(async (): Promise<number> => {
    try {
      const offset = await meetingNotesService.getRecordingOffset();
      if (offset !== null) return offset;
    } catch (error) {
      console.warn('[LiveNotes] Could not read recording offset:', error);
    }
    return Math.max(0, Math.round((activeDurationRef.current ?? 0) * 1000));
  }, []);

  const append = useCallback((entry: Omit<NoteEntryInput, 'position'>) => {
    updateDraft((d) => ({
      entries: [...d.entries, { ...entry, position: d.entries.length }],
    }));
  }, [updateDraft]);

  const anchored = (range: TimeRange) => ({
    startMs: range.startMs,
    endMs: range.endMs,
    quotedText: quoteForRange(range, anchorSegmentsRef.current),
  });

  const addAgendaItem = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    append({
      id: newEntryId(), kind: 'agenda', tag: null, text: trimmed,
      startMs: null, endMs: null, quotedText: null, done: false,
    });
  }, [append]);

  /**
   * Commits the composer's text. `firstKeystrokeMs` is the offset when the user started typing
   * (null if unknown). Slash commands set the tag or add an agenda item. Returns false when
   * there was nothing to add.
   */
  const addFromInput = useCallback(async (input: string, firstKeystrokeMs: number | null): Promise<boolean> => {
    const parsed = parseNoteInput(input);
    if (!parsed.text) return false;
    if (parsed.kind === 'agenda') {
      addAgendaItem(parsed.text);
      return true;
    }
    const now = await getOffsetMs();
    append({
      id: newEntryId(), kind: 'note', tag: parsed.tag, text: parsed.text,
      done: false, ...anchored(noteAnchor(firstKeystrokeMs ?? now, now)),
    });
    return true;
  }, [addAgendaItem, append, getOffsetMs]);

  /** Bookmarks what was just said. Returns the new entry's id. */
  const addBookmark = useCallback(async (): Promise<string> => {
    const id = newEntryId();
    const now = await getOffsetMs();
    append({ id, kind: 'bookmark', tag: null, text: '', done: false, ...anchored(bookmarkAnchor(now)) });
    return id;
  }, [append, getOffsetMs]);

  const toggleAgendaItem = useCallback(async (id: string) => {
    const now = await getOffsetMs();
    updateDraft((d) => ({
      entries: d.entries.map((e) => {
        if (e.id !== id) return e;
        if (e.done) return { ...e, done: false, startMs: null, endMs: null };
        const range = agendaCheckRange(d.entries, now);
        return { ...e, done: true, startMs: range.startMs, endMs: range.endMs };
      }),
    }));
  }, [getOffsetMs, updateDraft]);

  const updateEntry = useCallback((id: string, patch: { text?: string; tag?: NoteTag | null }) => {
    updateDraft((d) => ({
      entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, [updateDraft]);

  const removeEntry = useCallback((id: string) => {
    updateDraft((d) => ({
      entries: d.entries.filter((e) => e.id !== id).map((e, position) => ({ ...e, position })),
    }));
  }, [updateDraft]);

  return {
    agenda,
    notes,
    anchorSegments,
    segmentMarks,
    getOffsetMs,
    addFromInput,
    addAgendaItem,
    addBookmark,
    toggleAgendaItem,
    updateEntry,
    removeEntry,
  };
}

export type LiveNotes = ReturnType<typeof useLiveNotes>;
