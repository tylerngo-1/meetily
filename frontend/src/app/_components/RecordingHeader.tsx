'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useMeetingDraft } from '@/contexts/MeetingDraftContext';
import { formatDuration } from '@/lib/format-duration';

const MAX_TITLE_LENGTH = 200;
const TICK_MS = 250;

/**
 * Smooth elapsed time from the backend's active duration, which RecordingStateContext
 * polls every 500ms. Interpolates between polls, freezes while paused, never goes backwards.
 */
function useElapsedSeconds(activeDuration: number | null, isRecording: boolean, isPaused: boolean): number {
  const baseRef = useRef({ seconds: 0, at: 0 });
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (activeDuration == null) return;
    baseRef.current = { seconds: activeDuration, at: performance.now() };
    setElapsed(prev => Math.max(prev, activeDuration));
  }, [activeDuration]);

  useEffect(() => {
    if (!isRecording) {
      baseRef.current = { seconds: 0, at: 0 };
      setElapsed(0);
      return;
    }
    if (isPaused) return;

    // Re-anchor on (re)start so a resume doesn't count the paused time.
    baseRef.current = { ...baseRef.current, at: performance.now() };
    const id = setInterval(() => {
      const { seconds, at } = baseRef.current;
      const next = seconds + (performance.now() - at) / 1000;
      setElapsed(prev => Math.max(prev, next));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [isRecording, isPaused]);

  return elapsed;
}

function EditableRecordingTitle() {
  const { draft, setDraftTitle } = useMeetingDraft();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(draft.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setValue(draft.title);
  }, [draft.title, isEditing]);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== draft.title) setDraftTitle(trimmed);
    else setValue(draft.title);
    setIsEditing(false);
  };

  const cancel = () => {
    setValue(draft.title);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={value}
        maxLength={MAX_TITLE_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        aria-label="Meeting title"
        className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-base font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      title="Rename meeting"
      aria-label={`Meeting title: ${draft.title || 'Untitled meeting'}. Click to rename.`}
      className="group flex min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left hover:border-gray-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <span className="truncate text-base font-semibold text-gray-900">
        {draft.title || 'Untitled meeting'}
      </span>
      <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

/**
 * RecordingHeader
 *
 * Shown while recording: recording status, elapsed time, and the editable meeting title.
 */
export function RecordingHeader() {
  const { isRecording, isPaused, activeDuration } = useRecordingState();
  const elapsed = useElapsedSeconds(activeDuration, isRecording, isPaused);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex flex-shrink-0 items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${isPaused ? 'bg-amber-500' : 'bg-red-500 motion-safe:animate-pulse'}`}
          aria-hidden="true"
        />
        <span
          aria-live="polite"
          className={`text-xs font-semibold uppercase tracking-wide ${isPaused ? 'text-amber-600' : 'text-red-600'}`}
        >
          {isPaused ? 'Paused' : 'Rec'}
        </span>
        <span className="text-sm font-medium tabular-nums text-gray-700" aria-label="Elapsed time">
          {formatDuration(elapsed)}
        </span>
      </div>
      <EditableRecordingTitle />
    </div>
  );
}
