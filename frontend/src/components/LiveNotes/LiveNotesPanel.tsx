'use client';

import dynamic from 'next/dynamic';
import { PanelRightClose } from 'lucide-react';
import type { NotesEditorHandle } from './NotesEditor';
import type { BlockTime, NotesDocument } from '@/lib/notes-document';

// BlockNote touches the DOM on import; load it on the client only.
const NotesEditor = dynamic(() => import('./NotesEditor'), {
  ssr: false,
  loading: () => <div className="px-14 py-3 text-sm text-gray-400">Loading notes…</div>,
});

interface LiveNotesPanelProps {
  editorRef: React.MutableRefObject<NotesEditorHandle | null>;
  initialDocument: NotesDocument;
  getOffsetMs: () => Promise<number>;
  onChange: (doc: NotesDocument, markdown: string) => void;
  onJumpToTime: (time: BlockTime) => void;
  onClose: () => void;
}

/**
 * LiveNotesPanel
 *
 * Notes pane shown next to the transcript while recording: one free-form page. Each line
 * remembers when it was written; ⌘B adds a bookmark line for what was just said.
 */
export function LiveNotesPanel({
  editorRef,
  initialDocument,
  getOffsetMs,
  onChange,
  onJumpToTime,
  onClose,
}: LiveNotesPanelProps) {
  return (
    <section aria-label="Your notes" className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Notes</h2>
          <p className="text-xs text-gray-500">
            Saved with this meeting. <kbd className="font-sans">⌘B</kbd> bookmarks what was just said.
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
          getOffsetMs={getOffsetMs}
          onChange={onChange}
          onJumpToTime={onJumpToTime}
        />
      </div>
    </section>
  );
}
