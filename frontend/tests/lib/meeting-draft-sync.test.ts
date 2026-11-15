import { describe, expect, mock, test } from 'bun:test';
import { EMPTY_DRAFT, type MeetingDraft } from '../../src/lib/meeting-draft';
import {
  applyDraftToMeeting,
  draftWithOnlyFailedParts,
  type DraftSyncDeps,
} from '../../src/services/meetingDraftSync';

const fullDraft: MeetingDraft = {
  ...EMPTY_DRAFT,
  title: 'Sprint planning',
  generatedTitle: 'Meeting 1',
  templateId: 'project_sync',
  prepContext: 'Terms: PDF export',
  participants: ['An'],
  entries: [
    { id: 'a', kind: 'note', tag: 'action', text: 'An: backend', startMs: 1, endMs: 2, quotedText: null, done: false, position: 9 },
  ],
};

function deps(failing: Partial<Record<keyof DraftSyncDeps, boolean>> = {}) {
  const make = (name: keyof DraftSyncDeps) =>
    mock(async () => {
      if (failing[name]) throw new Error(`${name} failed`);
    });
  return {
    saveTitle: make('saveTitle'),
    setPrep: make('setPrep'),
    setParticipants: make('setParticipants'),
    saveEntries: make('saveEntries'),
    saveNotes: make('saveNotes'),
  };
}

describe('applyDraftToMeeting', () => {
  test('saves every part with content', async () => {
    const d = deps();
    const result = await applyDraftToMeeting('m1', fullDraft, d as unknown as DraftSyncDeps);
    expect(result).toEqual({ titleApplied: 'Sprint planning', failed: [] });
    expect(d.saveTitle).toHaveBeenCalledWith('m1', 'Sprint planning');
    expect(d.setPrep).toHaveBeenCalledWith('m1', { templateId: 'project_sync', prepContext: 'Terms: PDF export', seriesId: null });
    expect(d.setParticipants).toHaveBeenCalledWith('m1', ['An']);
    const [, savedEntries] = d.saveEntries.mock.calls[0] as unknown as [string, { position: number }[]];
    expect(savedEntries[0].position).toBe(0);
  });

  test('makes no calls for an empty draft', async () => {
    const d = deps();
    const result = await applyDraftToMeeting('m1', { ...EMPTY_DRAFT }, d as unknown as DraftSyncDeps);
    expect(result).toEqual({ titleApplied: null, failed: [] });
    for (const fn of Object.values(d)) expect(fn).not.toHaveBeenCalled();
  });

  test('one failing part does not stop the others', async () => {
    const d = deps({ saveTitle: true, saveEntries: true });
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await applyDraftToMeeting('m1', fullDraft, d as unknown as DraftSyncDeps);
      expect(result.titleApplied).toBeNull();
      expect(result.failed).toEqual(['title', 'entries']);
      expect(d.setPrep).toHaveBeenCalled();
      expect(d.setParticipants).toHaveBeenCalled();
    } finally {
      console.error = originalError;
    }
  });
});

describe('notes document', () => {
  test('is saved as markdown plus JSON without times of deleted blocks', async () => {
    const d = deps();
    const withNotes: MeetingDraft = {
      ...EMPTY_DRAFT,
      notes: {
        version: 1,
        blocks: [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Scope', styles: {} }], children: [] }],
        times: { b1: { atMs: 1_000, kind: 'bookmark' }, deleted: { atMs: 2_000, kind: 'bookmark' } },
      },
      notesMarkdown: 'Scope',
    };
    const result = await applyDraftToMeeting('m1', withNotes, d as unknown as DraftSyncDeps);
    expect(result.failed).toEqual([]);
    const [meetingId, markdown, json] = d.saveNotes.mock.calls[0] as unknown as [string, string, string];
    expect(meetingId).toBe('m1');
    expect(markdown).toBe('Scope');
    expect(Object.keys(JSON.parse(json).times)).toEqual(['b1']);
  });

  test('an empty page is not saved', async () => {
    const d = deps();
    await applyDraftToMeeting('m1', { ...EMPTY_DRAFT, notesMarkdown: '' }, d as unknown as DraftSyncDeps);
    expect(d.saveNotes).not.toHaveBeenCalled();
  });
});

describe('draftWithOnlyFailedParts', () => {
  test('a retry redoes only the failed parts', async () => {
    const retryDraft = draftWithOnlyFailedParts(fullDraft, ['entries']);
    const d = deps();
    await applyDraftToMeeting('m1', retryDraft, d as unknown as DraftSyncDeps);
    expect(d.saveEntries).toHaveBeenCalledTimes(1);
    expect(d.saveTitle).not.toHaveBeenCalled();
    expect(d.setPrep).not.toHaveBeenCalled();
    expect(d.setParticipants).not.toHaveBeenCalled();
  });
});
