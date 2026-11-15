/**
 * Anchoring notes to the recording timeline: which transcript segments a time range points
 * at. Pure logic, no React or Tauri. See docs/plans/meeting-prep-and-live-notes.md, section 6.5.
 *
 * All times are milliseconds on the recording clock (pause-free; the same clock as the saved
 * audio and transcript `audio_start_time`).
 */

import type { NoteEntryInput } from '@/services/meetingNotesService';

/** A bookmark marks "what was just said". */
export const BOOKMARK_BEFORE_MS = 8_000;
export const BOOKMARK_AFTER_MS = 2_000;
/** When no segment overlaps an anchor, attach to the nearest one within this distance. */
export const NEAREST_SEGMENT_MS = 5_000;
export const MAX_QUOTE_CHARS = 500;

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface AnchorSegment {
  id: string;
  startMs: number;
  endMs: number;
  text?: string;
}

const clampMs = (ms: number) => Math.max(0, Math.round(ms));

/** Transcript segments use seconds; anchors use milliseconds. */
export function toAnchorSegments(
  segments: { id: string; timestamp: number; endTime?: number; text?: string }[],
): AnchorSegment[] {
  return segments.map((s) => {
    const startMs = clampMs(s.timestamp * 1000);
    const endMs = s.endTime !== undefined ? Math.max(startMs, clampMs(s.endTime * 1000)) : startMs;
    return { id: s.id, startMs, endMs, text: s.text };
  });
}

/**
 * Segments an anchor points at:
 * 1. every segment overlapping the range;
 * 2. otherwise the nearest segment within NEAREST_SEGMENT_MS;
 * 3. otherwise none (the entry still shows its own time and quote).
 */
export function segmentsForRange(range: TimeRange, segments: AnchorSegment[]): AnchorSegment[] {
  const overlapping = segments.filter((s) => s.startMs <= range.endMs && s.endMs >= range.startMs);
  if (overlapping.length > 0) return overlapping;

  let nearest: AnchorSegment | null = null;
  let nearestGap = Infinity;
  for (const s of segments) {
    const gap = s.endMs < range.startMs ? range.startMs - s.endMs : s.startMs - range.endMs;
    if (gap < nearestGap) {
      nearest = s;
      nearestGap = gap;
    }
  }
  return nearest && nearestGap <= NEAREST_SEGMENT_MS ? [nearest] : [];
}

export type SegmentMark = 'bookmark' | 'note';

/**
 * Which transcript segments to highlight, and for which entries. A segment touched by a
 * bookmark is marked `bookmark` even if notes point at it too. Agenda items are not marked:
 * they span whole topics.
 */
export function resolveSegmentMarks(
  entries: Pick<NoteEntryInput, 'id' | 'kind' | 'startMs' | 'endMs'>[],
  segments: AnchorSegment[],
): Map<string, { mark: SegmentMark; entryIds: string[] }> {
  const marks = new Map<string, { mark: SegmentMark; entryIds: string[] }>();
  for (const entry of entries) {
    if (entry.kind === 'agenda' || entry.startMs === null) continue;
    const range = { startMs: entry.startMs, endMs: entry.endMs ?? entry.startMs };
    for (const segment of segmentsForRange(range, segments)) {
      const current = marks.get(segment.id);
      const mark: SegmentMark = entry.kind === 'bookmark' || current?.mark === 'bookmark' ? 'bookmark' : 'note';
      marks.set(segment.id, { mark, entryIds: [...(current?.entryIds ?? []), entry.id] });
    }
  }
  return marks;
}

/** Transcript text under a range, kept with the entry as a record of what the user saw. */
export function quoteForRange(range: TimeRange, segments: AnchorSegment[]): string | null {
  const text = segmentsForRange(range, segments)
    .map((s) => s.text?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  if (!text) return null;
  return text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS - 1)}…` : text;
}
