'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { recordingService } from '@/services/recordingService';

/**
 * MeetingDraftContext
 *
 * Holds user-entered metadata for the meeting currently being recorded.
 * The meeting row only exists after the recording is saved, so the draft is
 * kept here and flushed to the database once a meeting id is available.
 */

export interface MeetingDraft {
  title: string;          // User-visible title, editable during recording
  generatedTitle: string; // Title the backend recorded with (folder name source)
}

interface MeetingDraftContextType {
  draft: MeetingDraft;
  setDraftTitle: (title: string) => void;
  /** Persist the draft to the saved meeting. Returns the user's title if one was applied. */
  flushDraftToMeeting: (meetingId: string) => Promise<string | null>;
}

const STORAGE_KEY = 'meetily.meetingDraft';
const EMPTY_DRAFT: MeetingDraft = { title: '', generatedTitle: '' };

const MeetingDraftContext = createContext<MeetingDraftContextType | null>(null);

function readStoredDraft(): MeetingDraft {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw);
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      generatedTitle: typeof parsed.generatedTitle === 'string' ? parsed.generatedTitle : '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function writeStoredDraft(draft: MeetingDraft | null): void {
  try {
    if (draft) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Draft persistence only guards against renderer reloads; it is optional.
  }
}

export function MeetingDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<MeetingDraft>(EMPTY_DRAFT);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const updateDraft = useCallback((next: MeetingDraft | null) => {
    const value = next ?? EMPTY_DRAFT;
    draftRef.current = value;
    setDraft(value);
    writeStoredDraft(next);
  }, []);

  // Restore after a renderer reload mid-recording (recording-started won't fire again).
  useEffect(() => {
    const stored = readStoredDraft();
    if (stored.title || stored.generatedTitle) {
      draftRef.current = stored;
      setDraft(stored);
    }
  }, []);

  // Start a fresh draft for every recording, whichever path started it (UI, sidebar, tray).
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
      updateDraft({ title: name, generatedTitle: name });
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
  }, [updateDraft]);

  const setDraftTitle = useCallback((title: string) => {
    updateDraft({ ...draftRef.current, title });
  }, [updateDraft]);

  const flushDraftToMeeting = useCallback(async (meetingId: string): Promise<string | null> => {
    const { title, generatedTitle } = draftRef.current;
    const trimmed = title.trim();
    updateDraft(null);

    if (!trimmed || trimmed === generatedTitle.trim()) return null;

    try {
      await invoke('api_save_meeting_title', { meetingId, title: trimmed });
      return trimmed;
    } catch (error) {
      console.error('[MeetingDraft] Failed to save meeting title:', error);
      toast.warning('Could not save meeting title', {
        description: 'The meeting was saved with its original name. You can rename it from the sidebar.',
      });
      return null;
    }
  }, [updateDraft]);

  return (
    <MeetingDraftContext.Provider value={{ draft, setDraftTitle, flushDraftToMeeting }}>
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
