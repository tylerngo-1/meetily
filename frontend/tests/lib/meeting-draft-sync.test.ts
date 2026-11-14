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
      expect(result.failed).toEqual(['title', 'notes']);
      expect(d.setPrep).toHaveBeenCalled();
      expect(d.setParticipants).toHaveBeenCalled();
    } finally {
      console.error = originalError;
    }
  });
});

describe('draftWithOnlyFailedParts', () => {
  test('a retry redoes only the failed parts', async () => {
    const retryDraft = draftWithOnlyFailedParts(fullDraft, ['notes']);
    const d = deps();
    await applyDraftToMeeting('m1', retryDraft, d as unknown as DraftSyncDeps);
    expect(d.saveEntries).toHaveBeenCalledTimes(1);
    expect(d.saveTitle).not.toHaveBeenCalled();
    expect(d.setPrep).not.toHaveBeenCalled();
    expect(d.setParticipants).not.toHaveBeenCalled();
  });
});
