import { describe, expect, test } from 'bun:test';
import {
  assignBlockTimes,
  blockTimeRange,
  blocksNeedingTimes,
  bookmarkAnchors,
  flattenBlocks,
  isNotesDocumentEmpty,
  normalizeNotesDocument,
  pruneBlockTimes,
  visibleTimeIds,
  type NotesDocument,
} from '../../src/lib/notes-document';

// Minimal BlockNote-shaped blocks.
const block = (id: string, text: string, children: unknown[] = []) => ({
  id,
  type: 'paragraph',
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children,
});

const doc = (blocks: unknown[], times: NotesDocument['times'] = {}): NotesDocument => ({ version: 1, blocks, times });

describe('flattenBlocks', () => {
  test('walks children in document order and reads link text', () => {
    const blocks = [
      block('a', 'Scope', [block('a1', 'PDF export')]),
      { id: 'b', content: [{ type: 'link', content: [{ type: 'text', text: 'spec' }] }], children: [] },
    ];
    expect(flattenBlocks(blocks)).toEqual([
      { id: 'a', text: 'Scope' },
      { id: 'a1', text: 'PDF export' },
      { id: 'b', text: 'spec' },
    ]);
  });
});

describe('assignBlockTimes', () => {
  test('times only blocks that have text and no time yet', () => {
    const blocks = [block('a', 'first'), block('b', ''), block('c', '  ')];
    const times = assignBlockTimes({}, blocks, 12_345.6);
    expect(times).toEqual({ a: { atMs: 12_346, kind: 'note' } });
    expect(blocksNeedingTimes(times, blocks)).toEqual([]);
  });

  test('keeps existing times when a block is edited later', () => {
    const before = { a: { atMs: 1_000, kind: 'note' as const } };
    const after = assignBlockTimes(before, [block('a', 'first, edited'), block('b', 'second')], 60_000);
    expect(after.a.atMs).toBe(1_000);
    expect(after.b.atMs).toBe(60_000);
  });

  test('returns the same object when nothing changed', () => {
    const times = { a: { atMs: 1, kind: 'note' as const } };
    expect(assignBlockTimes(times, [block('a', 'x')], 5)).toBe(times);
  });
});

describe('pruneBlockTimes', () => {
  test('drops times of deleted blocks', () => {
    const times = { a: { atMs: 1, kind: 'note' as const }, gone: { atMs: 2, kind: 'note' as const } };
    expect(Object.keys(pruneBlockTimes(times, [block('a', 'x')]))).toEqual(['a']);
  });
});

describe('ranges', () => {
  test('a note looks back 3 s; a bookmark covers 8 s back to 2 s ahead', () => {
    expect(blockTimeRange({ atMs: 10_000, kind: 'note' })).toEqual({ startMs: 7_000, endMs: 10_000 });
    expect(blockTimeRange({ atMs: 20_000, kind: 'bookmark' })).toEqual({ startMs: 12_000, endMs: 22_000 });
    expect(blockTimeRange({ atMs: 1_000, kind: 'bookmark' }).startMs).toBe(0);
  });

  test('only bookmarks become transcript anchors', () => {
    const d = doc([block('a', 'x'), block('b', '🔖 ')], {
      a: { atMs: 5_000, kind: 'note' },
      b: { atMs: 9_000, kind: 'bookmark' },
    });
    expect(bookmarkAnchors(d)).toEqual([{ id: 'b', kind: 'bookmark', startMs: 1_000, endMs: 11_000 }]);
  });
});

describe('visibleTimeIds', () => {
  test('shows the first time, bookmarks, and times a minute apart', () => {
    const d = doc(
      [block('a', '1'), block('b', '2'), block('c', '3'), block('d', '🔖 '), block('e', '5')],
      {
        a: { atMs: 0, kind: 'note' },
        b: { atMs: 20_000, kind: 'note' },
        c: { atMs: 70_000, kind: 'note' },
        d: { atMs: 80_000, kind: 'bookmark' },
        e: { atMs: 100_000, kind: 'note' },
      },
    );
    expect([...visibleTimeIds(d)]).toEqual(['a', 'c', 'd']);
  });
});

describe('normalizeNotesDocument', () => {
  test('keeps valid parts and drops invalid times', () => {
    const d = normalizeNotesDocument({
      blocks: [block('a', 'x')],
      times: { a: { atMs: 5.4, kind: 'bookmark', quotedText: 'hi' }, b: { atMs: -1 }, c: 'nope' },
    });
    expect(d.times).toEqual({ a: { atMs: 5, kind: 'bookmark', quotedText: 'hi' } });
    expect(normalizeNotesDocument(null)).toEqual({ version: 1, blocks: [], times: {} });
  });

  test('a document of empty lines is empty', () => {
    expect(isNotesDocumentEmpty(doc([block('a', ''), block('b', ' ')]))).toBe(true);
    expect(isNotesDocumentEmpty(doc([block('a', 'x')]))).toBe(false);
  });
});
