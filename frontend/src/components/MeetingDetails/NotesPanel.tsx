'use client';

import { LoaderIcon } from 'lucide-react';
import { NotesEditorLazy as NotesEditor } from '@/components/LiveNotes/NotesEditorLazy';
import type { MeetingNotesStatus } from '@/hooks/meeting-details/useMeetingNotes';
import type { BlockTime, NotesDocument } from '@/lib/notes-document';

interface NotesPanelProps {
  status: MeetingNotesStatus;
  initialDocument: NotesDocument;
  initialMarkdown: string | null;
  hadNotes: boolean;
  onChange: (doc: NotesDocument, markdown: string) => void;
  onJumpToTime: (time: BlockTime) => void;
}

/**
 * NotesPanel
 *
 * The notes written during the meeting, on the meeting details page. Same editor as during
 * recording; lines added here get no time.
 */
export function NotesPanel({
  status,
  initialDocument,
  initialMarkdown,
  hadNotes,
  onChange,
  onJumpToTime,
}: NotesPanelProps) {
  return (
    <section aria-label="Your notes" className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-100 px-4 py-3">
        <p className="text-xs text-gray-500">
          {hadNotes
            ? 'Your notes from this meeting. Click a time to see that part of the transcript.'
            : 'No notes were taken during this meeting. Write anything here; it is saved with the meeting.'}
        </p>
      </header>
      <div className="min-h-0 flex-1">
        {status === 'loading' && (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400">
            <LoaderIcon className="size-4 animate-spin" /> Loading notes…
          </div>
        )}
        {/* Never show an editor over notes that failed to load: saving it would erase them. */}
        {status === 'error' && (
          <p role="alert" className="px-4 py-3 text-sm text-red-600">
            Couldn&apos;t load the notes for this meeting. Reopen the meeting to try again.
          </p>
        )}
        {status === 'ready' && (
          <NotesEditor
            initialDocument={initialDocument}
            initialMarkdown={initialMarkdown}
            onChange={onChange}
            onJumpToTime={onJumpToTime}
          />
        )}
      </div>
    </section>
  );
}
