'use client';

import dynamic from 'next/dynamic';

/** BlockNote touches the DOM on import; load the notes editor on the client only. */
export const NotesEditorLazy = dynamic(() => import('./NotesEditor'), {
  ssr: false,
  loading: () => <div className="px-14 py-3 text-sm text-gray-400">Loading notes…</div>,
});
