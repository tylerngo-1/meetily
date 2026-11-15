'use client';

import { PanelRightClose } from 'lucide-react';
import type { NotesEditorHandle } from './NotesEditor';
import { NotesEditorLazy as NotesEditor } from './NotesEditorLazy';
import type { BlockTime, NotesDocument } from '@/lib/notes-document';

/**
 * `recording`: notes and bookmarks. `finishing`: recording stopped, transcription is finishing;
 * notes can still be edited. `saving` / `saved`: the meeting is being saved; notes are read-only.
 */
export type LiveNotesPhase = 'recording' | 'finishing' | 'saving' | 'saved';

const PHASE_HINT: Record<Exclude<LiveNotesPhase, 'recording'>, string> = {
  finishing: 'Recording stopped. You can still finish your notes.',
  saving: 'Saving your notes with the meeting…',
  saved: 'Notes saved. Opening the meeting…',
};

interface LiveNotesPanelProps {
  phase: LiveNotesPhase;
  editorRef: React.MutableRefObject<NotesEditorHandle | null>;
  initialDocument: NotesDocument;
  onChange: (doc: NotesDocument, markdown: string) => void;
  onJumpToTime: (time: BlockTime) => void;
  onClose: () => void;
}

/**
 * LiveNotesPanel
 *
 * Notes pane shown next to the transcript while recording: one free-form page. ⌘B adds
 * a bookmark line, with its time, for what was just said.
 */
export function LiveNotesPanel({
  phase,
  editorRef,
  initialDocument,
  onChange,
  onJumpToTime,
  onClose,
}: LiveNotesPanelProps) {
  return (
    <section aria-label="Your notes" className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Notes</h2>
          <p className="text-xs text-gray-500" aria-live="polite">
            {phase === 'recording' ? (
              <>Saved with this meeting. <kbd className="font-sans">⌘B</kbd> bookmarks what was just said.</>
            ) : (
              PHASE_HINT[phase]
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide notes"
          title="Hide notes (⌘J)"
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <NotesEditor
          handleRef={editorRef}
          initialDocument={initialDocument}
          readOnly={phase === 'saving' || phase === 'saved'}
          onChange={onChange}
          onJumpToTime={onJumpToTime}
        />
      </div>
    </section>
  );
}
