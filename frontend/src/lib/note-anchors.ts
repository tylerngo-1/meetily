/**
 * Anchoring notes to the recording timeline, and the note composer's slash commands.
 * Pure logic, no React or Tauri. See docs/plans/meeting-prep-and-live-notes.md, sections 4.3
 * and 6.5.
 *
 * All times are milliseconds on the recording clock (pause-free; the same clock as the saved
 * audio and transcript `audio_start_time`).
 */

import type { NoteEntryInput, NoteEntryKind, NoteTag } from '@/services/meetingNotesService';

/** People start typing after hearing something; look back this far from the first keystroke. */
export const NOTE_LOOKBACK_MS = 3_000;
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

export function noteAnchor(firstKeystrokeMs: number, committedMs: number): TimeRange {
  const startMs = clampMs(firstKeystrokeMs - NOTE_LOOKBACK_MS);
  return { startMs, endMs: Math.max(startMs, clampMs(committedMs)) };
}

export function bookmarkAnchor(nowMs: number): TimeRange {
  return { startMs: clampMs(nowMs - BOOKMARK_BEFORE_MS), endMs: clampMs(nowMs + BOOKMARK_AFTER_MS) };
}

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

// Slash commands

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  tag: NoteTag | null;
  kind: NoteEntryKind;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: 'action', label: 'Action', description: 'Something someone has to do', tag: 'action', kind: 'note' },
  { command: 'decision', label: 'Decision', description: 'Something that was decided', tag: 'decision', kind: 'note' },
  { command: 'question', label: 'Question', description: 'An open question', tag: 'question', kind: 'note' },
  { command: 'agenda', label: 'Agenda item', description: 'Add a topic to the agenda', tag: null, kind: 'agenda' },
];

/** Commands to suggest while the user is typing `/xyz` with no space yet. */
export function matchSlashCommands(input: string): SlashCommand[] {
  const match = /^\/(\w*)$/.exec(input);
  if (!match) return [];
  const typed = match[1].toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.command.startsWith(typed));
}

export interface ParsedNoteInput {
  kind: NoteEntryKind;
  tag: NoteTag | null;
  text: string;
}

/** `/action Send the deck` → an action note "Send the deck". Unknown commands stay as text. */
export function parseNoteInput(input: string): ParsedNoteInput {
  const match = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  const command = match && SLASH_COMMANDS.find((c) => c.command === match[1].toLowerCase());
  if (!match || !command) return { kind: 'note', tag: null, text: input.trim() };
  return { kind: command.kind, tag: command.tag, text: (match[2] ?? '').trim() };
}

/** Agenda checking: a checked item covers the time since the previous checked item. */
export function agendaCheckRange(
  entries: Pick<NoteEntryInput, 'id' | 'kind' | 'done' | 'endMs'>[],
  nowMs: number,
): TimeRange {
  const previousEnd = entries
    .filter((e) => e.kind === 'agenda' && e.done && e.endMs !== null)
    .reduce((max, e) => Math.max(max, e.endMs ?? 0), 0);
  const endMs = clampMs(nowMs);
  return { startMs: Math.min(previousEnd, endMs), endMs };
}
