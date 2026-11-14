import { describe, expect, test } from 'bun:test';
import {
  MAX_QUOTE_CHARS,
  quoteForRange,
  resolveSegmentMarks,
  segmentsForRange,
  toAnchorSegments,
  type AnchorSegment,
} from '../../src/lib/note-anchors';

const seg = (id: string, startS: number, endS: number, text = id): AnchorSegment => ({
  id,
  startMs: startS * 1000,
  endMs: endS * 1000,
  text,
});

const transcript = [seg('s1', 0, 4), seg('s2', 5, 9), seg('s3', 30, 34)];

describe('toAnchorSegments', () => {
  test('converts transcript seconds to ms, tolerating a missing end', () => {
    expect(toAnchorSegments([{ id: 'a', timestamp: 1.25, endTime: 2.5 }, { id: 'b', timestamp: 3 }])).toEqual([
      { id: 'a', startMs: 1_250, endMs: 2_500, text: undefined },
      { id: 'b', startMs: 3_000, endMs: 3_000, text: undefined },
    ]);
  });
});

describe('segmentsForRange', () => {
  test('returns every overlapping segment', () => {
    expect(segmentsForRange({ startMs: 3_000, endMs: 6_000 }, transcript).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  test('falls back to the nearest segment within 5 s', () => {
    expect(segmentsForRange({ startMs: 12_000, endMs: 13_000 }, transcript).map((s) => s.id)).toEqual(['s2']);
  });

  test('returns nothing when no segment is close', () => {
    expect(segmentsForRange({ startMs: 18_000, endMs: 20_000 }, transcript)).toEqual([]);
    expect(segmentsForRange({ startMs: 0, endMs: 1 }, [])).toEqual([]);
  });

  test('re-segmented transcripts still resolve (re-transcription)', () => {
    const resegmented = [seg('n1', 0, 2), seg('n2', 2, 7), seg('n3', 7, 9)];
    expect(segmentsForRange({ startMs: 5_500, endMs: 6_000 }, resegmented).map((s) => s.id)).toEqual(['n2']);
  });
});

describe('resolveSegmentMarks', () => {
  test('bookmarks win over notes; agenda and unanchored entries are ignored', () => {
    const marks = resolveSegmentMarks(
      [
        { id: 'n', kind: 'note', startMs: 1_000, endMs: 2_000 },
        { id: 'b', kind: 'bookmark', startMs: 0, endMs: 6_000 },
        { id: 'g', kind: 'agenda', startMs: 0, endMs: 40_000 },
        { id: 'x', kind: 'note', startMs: null, endMs: null },
      ],
      transcript,
    );
    expect(marks.get('s1')).toEqual({ mark: 'bookmark', entryIds: ['n', 'b'] });
    expect(marks.get('s2')).toEqual({ mark: 'bookmark', entryIds: ['b'] });
    expect(marks.has('s3')).toBe(false);
  });
});

describe('quoteForRange', () => {
  test('joins segment text and caps the length', () => {
    expect(quoteForRange({ startMs: 3_000, endMs: 6_000 }, transcript)).toBe('s1 s2');
    const long = [seg('l', 0, 1, 'x'.repeat(MAX_QUOTE_CHARS + 50))];
    expect(quoteForRange({ startMs: 0, endMs: 1_000 }, long)!.length).toBe(MAX_QUOTE_CHARS);
    expect(quoteForRange({ startMs: 100_000, endMs: 101_000 }, transcript)).toBeNull();
  });
});
