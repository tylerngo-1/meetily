'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { meetingNotesService } from '@/services/meetingNotesService';
import {
  EMPTY_NOTES_DOCUMENT,
  isNotesDocumentEmpty,
  parseNotesJson,
  serializeNotesDocument,
  type NotesDocument,
} from '@/lib/notes-document';

export type MeetingNotesStatus = 'loading' | 'ready' | 'error';

/**
 * The notes page of a saved meeting (`meeting_notes`): loads it once and saves edits.
 * Saves run one at a time, in order, so an older save can never land after a newer one.
 */
export function useMeetingNotes(meetingId: string) {
  const [status, setStatus] = useState<MeetingNotesStatus>('loading');
  const [document, setDocument] = useState<NotesDocument>(EMPTY_NOTES_DOCUMENT);
  const [initialMarkdown, setInitialMarkdown] = useState<string | null>(null);
  /** Whether the meeting had notes when the page opened; decides which tab opens first. */
  const [hadNotes, setHadNotes] = useState(false);

  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveErrorShownRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    meetingNotesService
      .getMeetingNotes(meetingId)
      .then((record) => {
        if (cancelled) return;
        const doc = parseNotesJson(record?.notesJson) ?? EMPTY_NOTES_DOCUMENT;
        const markdown = record?.notesMarkdown ?? null;
        setDocument(doc);
        setInitialMarkdown(markdown);
        setHadNotes(!isNotesDocumentEmpty(doc) || Boolean(markdown?.trim()));
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[MeetingNotes] Failed to load notes:', error);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const saveNotes = useCallback(
    (doc: NotesDocument, markdown: string) => {
      setDocument(doc);
      const json = serializeNotesDocument(doc);
      saveChainRef.current = saveChainRef.current.then(async () => {
        try {
          await meetingNotesService.saveMeetingNotes(meetingId, markdown, json);
          saveErrorShownRef.current = false;
        } catch (error) {
          console.error('[MeetingNotes] Failed to save notes:', error);
          if (!saveErrorShownRef.current) {
            saveErrorShownRef.current = true;
            toast.error("Couldn't save your notes", {
              description: 'Keep this page open and try editing again.',
            });
          }
        }
      });
    },
    [meetingId],
  );

  return { status, document, initialMarkdown, hadNotes, saveNotes };
}
