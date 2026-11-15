import { describe, expect, test } from 'bun:test';
import {
  blockTimeRange,
  countNoteLines,
  parseNotesJson,
  serializeNotesDocument,
  bookmarkAnchors,
  flattenBlocks,
  isNotesDocumentEmpty,
  normalizeNotesDocument,
  pruneBlockTimes,
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

describe('pruneBlockTimes', () => {
  test('drops times of deleted blocks', () => {
    const times = { a: { atMs: 1, kind: 'bookmark' as const }, gone: { atMs: 2, kind: 'bookmark' as const } };
    expect(Object.keys(pruneBlockTimes(times, [block('a', 'x')]))).toEqual(['a']);
  });
});

describe('ranges', () => {
  test('a bookmark covers 8 s back to 2 s ahead', () => {
    expect(blockTimeRange({ atMs: 20_000, kind: 'bookmark' })).toEqual({ startMs: 12_000, endMs: 22_000 });
    expect(blockTimeRange({ atMs: 1_000, kind: 'bookmark' }).startMs).toBe(0);
  });

  test('bookmarks become transcript anchors', () => {
    const d = doc([block('a', 'x'), block('b', '🔖 ')], { b: { atMs: 9_000, kind: 'bookmark' } });
    expect(bookmarkAnchors(d)).toEqual([{ id: 'b', kind: 'bookmark', startMs: 1_000, endMs: 11_000 }]);
  });
});

describe('normalizeNotesDocument', () => {
  test('keeps valid parts, drops invalid times and times of plain lines', () => {
    const d = normalizeNotesDocument({
      blocks: [block('a', 'x')],
      times: {
        a: { atMs: 5.4, kind: 'bookmark', quotedText: 'hi' },
        b: { atMs: -1, kind: 'bookmark' },
        c: 'nope',
        old: { atMs: 3_000, kind: 'note' }, // earlier builds timed every line
      },
    });
    expect(d.times).toEqual({ a: { atMs: 5, kind: 'bookmark', quotedText: 'hi' } });
    expect(normalizeNotesDocument(null)).toEqual({ version: 1, blocks: [], times: {} });
  });

  test('a document of empty lines is empty', () => {
    expect(isNotesDocumentEmpty(doc([block('a', ''), block('b', ' ')]))).toBe(true);
    expect(isNotesDocumentEmpty(doc([block('a', 'x')]))).toBe(false);
  });
});

describe('stored notes', () => {
  test('count only lines with text', () => {
    expect(countNoteLines(doc([block('a', 'x', [block('a1', 'y')]), block('b', ' ')]))).toBe(2);
  });

  test('round-trip through notes_json; unreadable JSON is not an empty page', () => {
    const d = doc([block('a', 'x')], { a: { atMs: 1, kind: 'bookmark' }, gone: { atMs: 2, kind: 'bookmark' } });
    const back = parseNotesJson(serializeNotesDocument(d));
    expect(back?.blocks).toEqual(d.blocks);
    expect(Object.keys(back!.times)).toEqual(['a']);
    expect(parseNotesJson('{broken')).toBeNull();
    expect(parseNotesJson(null)).toBeNull();
  });
});
