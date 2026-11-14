'use client';

import { Bookmark, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FakeWaveform } from '@/components/FakeWaveform';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useElapsedSeconds } from '@/hooks/useElapsedSeconds';
import { formatDuration } from '@/lib/format-duration';

interface RecordingControlBarProps {
  isPaused: boolean;
  isPausing: boolean;
  isResuming: boolean;
  isStopping: boolean;
  isStartingRecording: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /** Bookmarks what was just said. The button is hidden when not provided. */
  onBookmark?: () => void;
}

// Own component so the 250ms timer tick re-renders only this span.
function ElapsedTime({ isPaused }: { isPaused: boolean }) {
  const { isRecording, activeDuration } = useRecordingState();
  const elapsed = useElapsedSeconds(activeDuration, isRecording, isPaused);

  // aria-hidden: RecordingHeader already exposes the elapsed time as role="timer".
  return (
    <span
      aria-hidden="true"
      className={`min-w-[3.5rem] text-center font-mono text-base tabular-nums ${isPaused ? 'text-amber-600' : 'text-gray-600'}`}
    >
      {formatDuration(elapsed)}
    </span>
  );
}

/**
 * RecordingControlBar
 *
 * Card shown while recording: waveform, elapsed time, Bookmark, Pause/Resume and Stop.
 */
export function RecordingControlBar({
  isPaused,
  isPausing,
  isResuming,
  isStopping,
  isStartingRecording,
  onPause,
  onResume,
  onStop,
  onBookmark,
}: RecordingControlBarProps) {
  const pauseLabel = isPausing ? 'Pausing…' : isResuming ? 'Resuming…' : isPaused ? 'Resume' : 'Pause';

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white py-3 pl-6 pr-3 shadow-lg">
      <FakeWaveform isPaused={isPaused} />
      <ElapsedTime isPaused={isPaused} />
      <div className="flex items-center gap-2">
        {onBookmark && (
          <Button
            variant="ghost"
            onClick={onBookmark}
            aria-label="Bookmark what was just said"
            title="Bookmark what was just said (⌘B)"
            className="h-10 w-10 rounded-lg bg-gray-100 p-0 text-gray-900 hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Bookmark />
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={isPaused ? onResume : onPause}
          disabled={isPausing || isResuming || isStopping}
          className="h-10 min-w-[7.5rem] rounded-lg bg-gray-100 px-4 text-base text-gray-900 hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isPaused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
          {pauseLabel}
        </Button>
        <Button
          variant="ghost"
          onClick={onStop}
          disabled={isStopping || isPausing || isResuming || isStartingRecording}
          className="h-10 min-w-[7.5rem] rounded-lg bg-red-50 px-4 text-base text-red-600 hover:bg-red-100 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <Square className="fill-current !size-3.5" />
          {isStopping ? 'Stopping…' : 'Stop'}
        </Button>
      </div>
    </div>
  );
}
