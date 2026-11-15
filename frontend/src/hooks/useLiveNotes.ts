'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useMeetingDraft } from '@/contexts/MeetingDraftContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { meetingNotesService } from '@/services/meetingNotesService';
import { quoteForRange, resolveSegmentMarks, toAnchorSegments } from '@/lib/note-anchors';
import { blockTimeRange, bookmarkAnchors, type NotesDocument } from '@/lib/notes-document';

/**
 * Notes taken during a recording. The document lives in the meeting draft
 * (MeetingDraftContext) and is saved with the meeting after stop. Times come from the core's
 * recording clock, so they stay right across pauses and re-transcription.
 */
export function useLiveNotes() {
  const { draft, updateDraft } = useMeetingDraft();
  const { transcripts } = useTranscripts();
  const { activeDuration, isRecording } = useRecordingState();
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

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

  // Only bookmarks are marked in the transcript; marking every note line would mark most of it.
  const segmentMarks = useMemo(
    () => resolveSegmentMarks(bookmarkAnchors(draft.notes), anchorSegments),
    [draft.notes, anchorSegments],
  );

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

  /** Transcript text around a bookmark made at `atMs`. */
  const quoteForBookmark = useCallback(
    (atMs: number) => quoteForRange(blockTimeRange({ atMs, kind: 'bookmark' }), anchorSegmentsRef.current),
    [],
  );

  // Only into the draft of the recording in progress: once the meeting is saved the draft is
  // reset for the next meeting, and a late save from this editor must not land in it. Right
  // after start the draft can still be in prep (recording-started not handled yet); that one
  // is this meeting's draft too.
  const saveNotes = useCallback((notes: NotesDocument, notesMarkdown: string) => {
    updateDraft((current) =>
      current.phase === 'recording' || (current.phase === 'prep' && isRecordingRef.current)
        ? { notes, notesMarkdown }
        : {},
    );
  }, [updateDraft]);

  return {
    notes: draft.notes,
    anchorSegments,
    segmentMarks,
    getOffsetMs,
    quoteForBookmark,
    saveNotes,
  };
}
