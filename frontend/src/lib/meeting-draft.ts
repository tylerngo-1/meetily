/**
 * Meeting draft: everything the user enters for a meeting before its database row exists
 * (prep on home, notes during recording). Pure logic, no Tauri or storage access.
 * See docs/plans/meeting-prep-and-live-notes.md, section 4.5.
 */

import type { MeetingPrep, NoteEntryInput, NoteEntryKind, NoteTag } from '@/services/meetingNotesService';

/** `prep`: being filled in on home. `recording`: attached to the recording in progress. */
export type DraftPhase = 'prep' | 'recording';

export type DraftEntry = NoteEntryInput;

export interface MeetingDraft {
  title: string;          // User-visible title
  generatedTitle: string; // Title the backend recorded with (folder name source)
  templateId: string | null;
  participants: string[];
  prepContext: string;
  seriesId: string | null;
  entries: DraftEntry[];
  phase: DraftPhase;
  /** IndexedDB recovery meeting id of the recording this draft belongs to. */
  recoveryMeetingId: string | null;
  updatedAt: number;
}

export const EMPTY_DRAFT: MeetingDraft = Object.freeze({
  title: '',
  generatedTitle: '',
  templateId: null,
  participants: [],
  prepContext: '',
  seriesId: null,
  entries: [],
  phase: 'prep',
  recoveryMeetingId: null,
  updatedAt: 0,
}) as MeetingDraft;

const KINDS: readonly NoteEntryKind[] = ['note', 'bookmark', 'agenda'];
const TAGS: readonly NoteTag[] = ['action', 'decision', 'question'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const msOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

function normalizeEntry(raw: unknown, index: number): DraftEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  const kind = r.kind as NoteEntryKind;
  if (!id || !KINDS.includes(kind)) return null;
  const tag = TAGS.includes(r.tag as NoteTag) ? (r.tag as NoteTag) : null;
  return {
    id,
    kind,
    tag,
    text: str(r.text),
    startMs: msOrNull(r.startMs),
    endMs: msOrNull(r.endMs),
    quotedText: strOrNull(r.quotedText),
    done: r.done === true,
    position: typeof r.position === 'number' ? r.position : index,
  };
}

/**
 * Parses a stored draft defensively: storage may hold an older shape (the first version had
 * only `title` and `generatedTitle`) or be corrupted. Invalid parts fall back to empty values.
 */
export function normalizeDraft(raw: unknown): MeetingDraft {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DRAFT };
  const r = raw as Record<string, unknown>;
  const entries = Array.isArray(r.entries)
    ? r.entries.map(normalizeEntry).filter((e): e is DraftEntry => e !== null)
    : [];
  return {
    title: str(r.title),
    generatedTitle: str(r.generatedTitle),
    templateId: strOrNull(r.templateId),
    participants: Array.isArray(r.participants)
      ? r.participants.filter((p): p is string => typeof p === 'string')
      : [],
    prepContext: str(r.prepContext),
    seriesId: strOrNull(r.seriesId),
    entries,
    phase: r.phase === 'recording' ? 'recording' : 'prep',
    recoveryMeetingId: strOrNull(r.recoveryMeetingId),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}

/** True when the draft holds nothing the user entered. */
export function isDraftEmpty(draft: MeetingDraft): boolean {
  return (
    !draft.title.trim() &&
    !draft.templateId &&
    draft.participants.every((p) => !p.trim()) &&
    !draft.prepContext.trim() &&
    !draft.seriesId &&
    draft.entries.length === 0
  );
}

/**
 * A recording started. Prep entered on home is kept (it belongs to this recording); only the
 * backend name is recorded. The user's title wins over the generated one.
 */
export function draftOnRecordingStarted(
  draft: MeetingDraft,
  backendName: string,
  recoveryMeetingId: string | null,
  now: number,
): MeetingDraft {
  // A draft still in the recording phase belongs to an earlier recording that was never
  // saved (a renderer reload mid-recording does not fire recording-started again).
  // Its content must not leak into this meeting.
  const base = draft.phase === 'recording' ? EMPTY_DRAFT : draft;
  return {
    ...base,
    title: base.title.trim() ? base.title : backendName,
    generatedTitle: backendName,
    phase: 'recording',
    recoveryMeetingId,
    updatedAt: now,
  };
}

export interface DraftFlushPlan {
  /** Title to save, when the user changed it from the generated one. */
  title: string | null;
  /** Prep fields to save, when any is set. */
  prep: MeetingPrep | null;
  /** Participant names, when any. */
  participants: string[] | null;
  /** Entries with positions renumbered in list order, when any. */
  entries: NoteEntryInput[] | null;
}

/** Decides which saves a draft needs, so empty drafts cause no writes at all. */
export function planDraftFlush(draft: MeetingDraft): DraftFlushPlan {
  const title = draft.title.trim();
  const participants = draft.participants.map((p) => p.trim()).filter(Boolean);
  const prep: MeetingPrep = {
    templateId: draft.templateId,
    prepContext: draft.prepContext.trim() ? draft.prepContext : null,
    seriesId: draft.seriesId,
  };
  const hasPrep = prep.templateId !== null || prep.prepContext !== null || prep.seriesId !== null;

  return {
    title: title && title !== draft.generatedTitle.trim() ? title : null,
    prep: hasPrep ? prep : null,
    participants: participants.length > 0 ? participants : null,
    entries:
      draft.entries.length > 0
        ? draft.entries.map((entry, index) => ({ ...entry, position: index }))
        : null,
  };
}

/**
 * What to do with the stored current draft when the app starts.
 * - `keep`: nothing happened to it (prep on home, or a recording that is still running after a
 *   renderer reload).
 * - `park`: it belonged to a recording that ended without being saved (crash or kill); move it
 *   aside so crash recovery can restore it, and start a fresh draft.
 * - `discard-notes`: same, but there is no recovery id to attach it to; keep prep, drop notes.
 */
export type StartupDraftAction = 'keep' | 'park' | 'discard-notes';

export function startupDraftAction(draft: MeetingDraft, isRecordingNow: boolean): StartupDraftAction {
  if (draft.phase !== 'recording' || isRecordingNow) return 'keep';
  return draft.recoveryMeetingId ? 'park' : 'discard-notes';
}

/** Storage keys of drafts in IndexedDB. */
export const draftKeys = {
  current: 'current',
  /** Draft of a crashed recording, restored by crash recovery. */
  recovery: (recoveryMeetingId: string) => `recovery:${recoveryMeetingId}`,
  /** Draft whose save to an existing meeting failed; retried at startup. */
  unsaved: (meetingId: string) => `unsaved:${meetingId}`,
};
