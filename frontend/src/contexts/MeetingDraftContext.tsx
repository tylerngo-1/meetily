'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { recordingService } from '@/services/recordingService';
import { indexedDBService } from '@/services/indexedDBService';
import {
  applyDraftToMeeting,
  draftWithOnlyFailedParts,
  type DraftPart,
} from '@/services/meetingDraftSync';
import {
  EMPTY_DRAFT,
  draftKeys,
  draftOnRecordingStarted,
  isDraftEmpty,
  normalizeDraft,
  startupDraftAction,
  type MeetingDraft,
} from '@/lib/meeting-draft';

/**
 * MeetingDraftContext
 *
 * Holds what the user enters for a meeting before its database row exists: prep on home
 * (title, type, participants, context, series) and notes taken during recording. The meeting
 * row is only created when the recording is saved, so the draft is flushed then.
 *
 * The draft is persisted to IndexedDB so it survives renderer reloads, app restarts before
 * recording, and crashes during recording (crash recovery restores it with the meeting).
 * See docs/plans/meeting-prep-and-live-notes.md, section 4.5.
 */

export type { MeetingDraft } from '@/lib/meeting-draft';

type DraftUpdate = Partial<MeetingDraft> | ((draft: MeetingDraft) => Partial<MeetingDraft>);

interface MeetingDraftContextType {
  draft: MeetingDraft;
  /** False until the stored draft has been loaded; avoid showing an empty form before that. */
  isHydrated: boolean;
  setDraftTitle: (title: string) => void;
  updateDraft: (update: DraftUpdate) => void;
  resetDraft: () => void;
  /** Persist the draft to the saved meeting. Returns the user's title if one was applied. */
  flushDraftToMeeting: (meetingId: string) => Promise<string | null>;
}

const PERSIST_DEBOUNCE_MS = 300;
/** Drafts of crashed recordings and failed saves are kept as long as crash recovery keeps meetings. */
const STALE_DRAFT_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_SESSION_KEY = 'meetily.meetingDraft';

const PART_LABELS: Record<DraftPart, string> = {
  title: 'title',
  prep: 'meeting type and context',
  participants: 'participants',
  notes: 'notes',
};

const MeetingDraftContext = createContext<MeetingDraftContextType | null>(null);

function currentRecoveryMeetingId(): string | null {
  try {
    return sessionStorage.getItem('indexeddb_current_meeting_id');
  } catch {
    return null;
  }
}

async function writeCurrentDraft(draft: MeetingDraft): Promise<void> {
  try {
    if (isDraftEmpty(draft) && draft.phase === 'prep') {
      await indexedDBService.deleteDraft(draftKeys.current);
    } else {
      await indexedDBService.putDraft(draftKeys.current, draft);
    }
  } catch (error) {
    console.warn('[MeetingDraft] Failed to persist draft:', error);
  }
}

/** Retries saves that failed earlier, and drops drafts older than crash recovery keeps. */
async function processLeftoverDrafts(): Promise<void> {
  const now = Date.now();

  for (const stored of await indexedDBService.listDrafts('unsaved:')) {
    const meetingId = stored.key.slice('unsaved:'.length);
    if (now - stored.storedAt > STALE_DRAFT_MS) {
      await indexedDBService.deleteDraft(stored.key);
      continue;
    }
    const draft = normalizeDraft(stored.draft);
    const { failed } = await applyDraftToMeeting(meetingId, draft);
    if (failed.length === 0) {
      await indexedDBService.deleteDraft(stored.key);
    } else {
      await indexedDBService.putDraft(stored.key, draftWithOnlyFailedParts(draft, failed));
    }
  }

  for (const stored of await indexedDBService.listDrafts('recovery:')) {
    if (now - stored.storedAt > STALE_DRAFT_MS) {
      await indexedDBService.deleteDraft(stored.key);
    }
  }
}

export function MeetingDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<MeetingDraft>(EMPTY_DRAFT);
  const [isHydrated, setIsHydrated] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const changedBeforeHydrationRef = useRef(false);
  const hydratedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: MeetingDraft, immediate: boolean) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (immediate) {
      void writeCurrentDraft(next);
    } else {
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void writeCurrentDraft(draftRef.current);
      }, PERSIST_DEBOUNCE_MS);
    }
  }, []);

  const replaceDraft = useCallback((next: MeetingDraft, immediate: boolean) => {
    if (!hydratedRef.current) changedBeforeHydrationRef.current = true;
    draftRef.current = next;
    setDraft(next);
    persist(next, immediate);
  }, [persist]);

  const updateDraft = useCallback((update: DraftUpdate) => {
    const current = draftRef.current;
    const patch = typeof update === 'function' ? update(current) : update;
    const next: MeetingDraft = { ...current, ...patch, updatedAt: Date.now() };
    // The recovery id is set by TranscriptContext on recording-started; fill it in here if the
    // draft's own recording-started handler ran before it was available.
    if (next.phase === 'recording' && !next.recoveryMeetingId) {
      next.recoveryMeetingId = currentRecoveryMeetingId();
    }
    replaceDraft(next, false);
  }, [replaceDraft]);

  const setDraftTitle = useCallback((title: string) => updateDraft({ title }), [updateDraft]);

  const resetDraft = useCallback(() => replaceDraft({ ...EMPTY_DRAFT }, true), [replaceDraft]);

  // Load the stored draft, deal with drafts of recordings that ended without being saved, and
  // retry saves that failed earlier.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        sessionStorage.removeItem(LEGACY_SESSION_KEY);
      } catch {
        // Ignore: only cleans up the key used by the first version of the draft.
      }

      try {
        const stored = normalizeDraft((await indexedDBService.getDraft(draftKeys.current))?.draft);
        let isRecordingNow = true; // If unknown, keep the draft rather than move it away.
        try {
          isRecordingNow = await recordingService.isRecording();
        } catch (error) {
          console.warn('[MeetingDraft] Could not read recording state:', error);
        }

        let restored = stored;
        switch (startupDraftAction(stored, isRecordingNow)) {
          case 'park':
            await indexedDBService.putDraft(draftKeys.recovery(stored.recoveryMeetingId!), stored);
            restored = { ...EMPTY_DRAFT };
            break;
          case 'discard-notes':
            console.warn('[MeetingDraft] Dropping notes of an unsaved recording with no recovery id');
            restored = {
              ...stored,
              // The generated name belonged to that recording; a title the user typed is kept.
              title: stored.title === stored.generatedTitle ? '' : stored.title,
              generatedTitle: '',
              entries: [],
              phase: 'prep',
              recoveryMeetingId: null,
            };
            break;
          case 'keep':
            break;
        }

        if (!cancelled && !changedBeforeHydrationRef.current) {
          draftRef.current = restored;
          setDraft(restored);
          if (restored !== stored) await writeCurrentDraft(restored);
        }
      } catch (error) {
        console.warn('[MeetingDraft] Failed to load stored draft:', error);
      } finally {
        hydratedRef.current = true;
        if (!cancelled) setIsHydrated(true);
      }

      try {
        await processLeftoverDrafts();
      } catch (error) {
        console.warn('[MeetingDraft] Failed to process leftover drafts:', error);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Attach the draft to every recording, whichever path started it (UI, sidebar, tray).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    recordingService.onRecordingStarted(async () => {
      let name = '';
      try {
        name = (await recordingService.getRecordingMeetingName()) ?? '';
      } catch (error) {
        console.warn('[MeetingDraft] Failed to read recording meeting name:', error);
      }

      const previous = draftRef.current;
      if (previous.phase === 'recording' && previous.recoveryMeetingId && !isDraftEmpty(previous)) {
        // Notes of an earlier recording that was never saved: hand them to crash recovery.
        try {
          await indexedDBService.putDraft(draftKeys.recovery(previous.recoveryMeetingId), previous);
        } catch (error) {
          console.warn('[MeetingDraft] Failed to keep notes of an unsaved recording:', error);
        }
      }

      replaceDraft(
        draftOnRecordingStarted(draftRef.current, name, currentRecoveryMeetingId(), Date.now()),
        true,
      );
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    }).catch((error) => {
      console.error('[MeetingDraft] Failed to listen for recording-started:', error);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [replaceDraft]);

  useEffect(() => () => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
  }, []);

  const flushDraftToMeeting = useCallback(async (meetingId: string): Promise<string | null> => {
    const snapshot = draftRef.current;
    // Home shows an empty prep form for the next meeting right away.
    replaceDraft({ ...EMPTY_DRAFT }, true);

    const { titleApplied, failed } = await applyDraftToMeeting(meetingId, snapshot);
    if (failed.length > 0) {
      try {
        await indexedDBService.putDraft(
          draftKeys.unsaved(meetingId),
          draftWithOnlyFailedParts(snapshot, failed),
        );
      } catch (error) {
        console.error('[MeetingDraft] Failed to keep unsaved parts for retry:', error);
      }
      const parts = failed.map((part) => PART_LABELS[part]).join(', ');
      toast.warning(`Couldn't save the ${parts} of this meeting`, {
        description: 'The recording is saved. Meetily will try again the next time it starts.',
      });
    }
    return titleApplied;
  }, [replaceDraft]);

  return (
    <MeetingDraftContext.Provider
      value={{ draft, isHydrated, setDraftTitle, updateDraft, resetDraft, flushDraftToMeeting }}
    >
      {children}
    </MeetingDraftContext.Provider>
  );
}

export function useMeetingDraft() {
  const context = useContext(MeetingDraftContext);
  if (!context) {
    throw new Error('useMeetingDraft must be used within a MeetingDraftProvider');
  }
  return context;
}
