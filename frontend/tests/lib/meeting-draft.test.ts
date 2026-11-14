import { describe, expect, test } from 'bun:test';
import {
  EMPTY_DRAFT,
  draftOnRecordingStarted,
  isDraftEmpty,
  normalizeDraft,
  planDraftFlush,
  startupDraftAction,
  type MeetingDraft,
} from '../../src/lib/meeting-draft';
import type { NoteEntryInput } from '../../src/services/meetingNotesService';

const entry = (id: string, position = 0): NoteEntryInput => ({
  id,
  kind: 'note',
  tag: null,
  text: `text ${id}`,
  startMs: 1_000,
  endMs: 2_000,
  quotedText: null,
  done: false,
  position,
});

const draft = (patch: Partial<MeetingDraft> = {}): MeetingDraft => ({ ...EMPTY_DRAFT, ...patch });

describe('normalizeDraft', () => {
  test('returns an empty draft for missing or invalid input', () => {
    expect(normalizeDraft(undefined)).toEqual(EMPTY_DRAFT);
    expect(normalizeDraft('nope')).toEqual(EMPTY_DRAFT);
  });

  test('reads the first stored shape (title only)', () => {
    const d = normalizeDraft({ title: 'Standup', generatedTitle: 'Meeting 1' });
    expect(d.title).toBe('Standup');
    expect(d.generatedTitle).toBe('Meeting 1');
    expect(d.phase).toBe('prep');
    expect(d.entries).toEqual([]);
  });

  test('drops invalid entries and fields, keeps valid ones', () => {
    const d = normalizeDraft({
      participants: ['An', 3, 'Bình'],
      templateId: '  ',
      entries: [
        entry('a'),
        { id: 'b', kind: 'comment' },
        { id: '', kind: 'note' },
        { id: 'c', kind: 'bookmark', tag: 'todo', startMs: -5, endMs: 12.6 },
      ],
      phase: 'recording',
    });
    expect(d.participants).toEqual(['An', 'Bình']);
    expect(d.templateId).toBeNull();
    expect(d.entries.map((e) => e.id)).toEqual(['a', 'c']);
    expect(d.entries[1].tag).toBeNull();
    expect(d.entries[1].startMs).toBeNull();
    expect(d.entries[1].endMs).toBe(13);
    expect(d.phase).toBe('recording');
  });
});

describe('isDraftEmpty', () => {
  test('ignores whitespace-only fields', () => {
    expect(isDraftEmpty(draft({ title: ' ', participants: [' '], prepContext: '\n' }))).toBe(true);
    expect(isDraftEmpty(draft({ entries: [entry('a')] }))).toBe(false);
    expect(isDraftEmpty(draft({ templateId: 'daily_standup' }))).toBe(false);
  });
});

describe('draftOnRecordingStarted', () => {
  test('keeps prep from home and uses the user title', () => {
    const prep = draft({ title: 'Sprint planning', templateId: 'project_sync', entries: [entry('agenda')] });
    const started = draftOnRecordingStarted(prep, 'Meeting 2026-11-14', 'meeting-1', 42);
    expect(started.title).toBe('Sprint planning');
    expect(started.generatedTitle).toBe('Meeting 2026-11-14');
    expect(started.templateId).toBe('project_sync');
    expect(started.entries).toHaveLength(1);
    expect(started.phase).toBe('recording');
    expect(started.recoveryMeetingId).toBe('meeting-1');
    expect(started.updatedAt).toBe(42);
  });

  test('uses the backend name when no title was typed', () => {
    expect(draftOnRecordingStarted(draft(), 'Meeting X', null, 0).title).toBe('Meeting X');
  });

  test('does not carry over a draft from an earlier unsaved recording', () => {
    const stale = draft({ title: 'Old', phase: 'recording', entries: [entry('old')], recoveryMeetingId: 'meeting-0' });
    const started = draftOnRecordingStarted(stale, 'Meeting Y', 'meeting-2', 0);
    expect(started.title).toBe('Meeting Y');
    expect(started.entries).toEqual([]);
    expect(started.recoveryMeetingId).toBe('meeting-2');
  });
});

describe('planDraftFlush', () => {
  test('an empty or untouched draft causes no writes', () => {
    expect(planDraftFlush(draft({ title: 'Meeting 1', generatedTitle: 'Meeting 1' }))).toEqual({
      title: null,
      prep: null,
      participants: null,
      entries: null,
    });
  });

  test('plans each part that has content', () => {
    const plan = planDraftFlush(
      draft({
        title: ' Sprint planning ',
        generatedTitle: 'Meeting 1',
        templateId: 'daily_standup',
        prepContext: '  ',
        participants: [' An ', ''],
        entries: [entry('a', 5), entry('b', 2)],
      }),
    );
    expect(plan.title).toBe('Sprint planning');
    expect(plan.prep).toEqual({ templateId: 'daily_standup', prepContext: null, seriesId: null });
    expect(plan.participants).toEqual(['An']);
    expect(plan.entries?.map((e) => [e.id, e.position])).toEqual([['a', 0], ['b', 1]]);
  });
});

describe('startupDraftAction', () => {
  test('keeps prep drafts and drafts of a running recording', () => {
    expect(startupDraftAction(draft(), false)).toBe('keep');
    expect(startupDraftAction(draft({ phase: 'recording', recoveryMeetingId: 'm' }), true)).toBe('keep');
  });

  test('parks the draft of a recording that ended without being saved', () => {
    expect(startupDraftAction(draft({ phase: 'recording', recoveryMeetingId: 'm' }), false)).toBe('park');
    expect(startupDraftAction(draft({ phase: 'recording' }), false)).toBe('discard-notes');
  });
});
