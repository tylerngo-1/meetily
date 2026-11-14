/**
 * Writes a meeting draft (title, prep, participants, notes) to a saved meeting.
 * Shared by the normal stop flow, crash recovery and the startup retry of failed saves.
 */

import { invoke } from '@tauri-apps/api/core';
import { draftKeys, normalizeDraft, planDraftFlush, type MeetingDraft } from '@/lib/meeting-draft';
import { indexedDBService } from '@/services/indexedDBService';
import { meetingNotesService } from '@/services/meetingNotesService';

export type DraftPart = 'title' | 'prep' | 'participants' | 'notes';

export interface DraftSyncResult {
  /** The user's title, when it was saved. */
  titleApplied: string | null;
  /** Parts that failed to save. The others were saved. */
  failed: DraftPart[];
}

export interface DraftSyncDeps {
  saveTitle: (meetingId: string, title: string) => Promise<unknown>;
  setPrep: typeof meetingNotesService.setMeetingPrep;
  setParticipants: typeof meetingNotesService.setMeetingParticipants;
  saveEntries: typeof meetingNotesService.saveNoteEntries;
}

const defaultDeps: DraftSyncDeps = {
  saveTitle: (meetingId, title) => invoke('api_save_meeting_title', { meetingId, title }),
  setPrep: meetingNotesService.setMeetingPrep,
  setParticipants: meetingNotesService.setMeetingParticipants,
  saveEntries: meetingNotesService.saveNoteEntries,
};

/**
 * Saves every part the draft has. Parts are independent: one failure does not stop the
 * others. Every save replaces the stored value, so retrying the whole draft is safe.
 */
export async function applyDraftToMeeting(
  meetingId: string,
  draft: MeetingDraft,
  deps: DraftSyncDeps = defaultDeps,
): Promise<DraftSyncResult> {
  const plan = planDraftFlush(draft);
  const failed: DraftPart[] = [];
  let titleApplied: string | null = null;

  const attempt = async (part: DraftPart, save: () => Promise<unknown>) => {
    try {
      await save();
      return true;
    } catch (error) {
      console.error(`[MeetingDraft] Failed to save ${part} for meeting ${meetingId}:`, error);
      failed.push(part);
      return false;
    }
  };

  if (plan.title) {
    const title = plan.title;
    if (await attempt('title', () => deps.saveTitle(meetingId, title))) titleApplied = title;
  }
  if (plan.prep) {
    const prep = plan.prep;
    await attempt('prep', () => deps.setPrep(meetingId, prep));
  }
  if (plan.participants) {
    const names = plan.participants;
    await attempt('participants', () => deps.setParticipants(meetingId, names));
  }
  if (plan.entries) {
    const entries = plan.entries;
    await attempt('notes', () => deps.saveEntries(meetingId, entries));
  }

  return { titleApplied, failed };
}

/** Draft holding only the parts that failed, so a retry does not redo the others. */
export function draftWithOnlyFailedParts(draft: MeetingDraft, failed: DraftPart[]): MeetingDraft {
  const keep = new Set(failed);
  return {
    ...draft,
    // An unchanged title (equal to generatedTitle) is never saved, so this skips it.
    title: keep.has('title') ? draft.title : draft.generatedTitle,
    templateId: keep.has('prep') ? draft.templateId : null,
    prepContext: keep.has('prep') ? draft.prepContext : '',
    seriesId: keep.has('prep') ? draft.seriesId : null,
    participants: keep.has('participants') ? draft.participants : [],
    entries: keep.has('notes') ? draft.entries : [],
  };
}

/**
 * Crash recovery: saves the draft of a crashed recording (prep and notes) to the meeting that
 * recovery just created. Parts that fail are kept for the startup retry. Returns the failed parts.
 */
export async function restoreRecoveryDraft(
  recoveryMeetingId: string,
  savedMeetingId: string,
): Promise<DraftPart[]> {
  const key = draftKeys.recovery(recoveryMeetingId);
  const stored = await indexedDBService.getDraft(key);
  if (!stored) return [];

  const draft = normalizeDraft(stored.draft);
  const { failed } = await applyDraftToMeeting(savedMeetingId, draft);
  if (failed.length > 0) {
    await indexedDBService.putDraft(
      draftKeys.unsaved(savedMeetingId),
      draftWithOnlyFailedParts(draft, failed),
    );
  }
  await indexedDBService.deleteDraft(key);
  return failed;
}

/** Drops the draft of a crashed recording when the user discards that recording. */
export async function discardRecoveryDraft(recoveryMeetingId: string): Promise<void> {
  await indexedDBService.deleteDraft(draftKeys.recovery(recoveryMeetingId));
}
