/**
 * The free-form notes document taken during a meeting: the editor's blocks plus, for each
 * block, the moment on the recording clock when it was first written. Pure logic, no editor
 * or Tauri access. See docs/plans/meeting-prep-and-live-notes.md, section 6.
 *
 * Times are attached per block (paragraph, list item, heading, ...), because one long note
 * usually covers several things said at different moments.
 */

import { BOOKMARK_AFTER_MS, BOOKMARK_BEFORE_MS, NOTE_LOOKBACK_MS, type TimeRange } from '@/lib/note-anchors';

export type BlockTimeKind = 'note' | 'bookmark';

export interface BlockTime {
  /** When the block was first written (or the bookmark key pressed), ms on the recording clock. */
  atMs: number;
  kind: BlockTimeKind;
  /** Transcript text around a bookmark when it was made; shown as a hint, kept for the summary. */
  quotedText?: string | null;
}

export interface NotesDocument {
  version: 1;
  /** Editor blocks as produced by BlockNote (`editor.document`). Opaque here. */
  blocks: unknown[];
  times: Record<string, BlockTime>;
}

export const EMPTY_NOTES_DOCUMENT: NotesDocument = Object.freeze({
  version: 1,
  blocks: [],
  times: {},
}) as NotesDocument;

/** Text a bookmark block starts with; the user writes after it. */
export const BOOKMARK_PREFIX = '🔖 ';

interface BlockLike {
  id?: unknown;
  content?: unknown;
  children?: unknown;
}

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const i = item as { text?: unknown; content?: unknown };
      if (typeof i.text === 'string') return i.text;
      return inlineText(i.content); // links nest their text
    })
    .join('');
}

export interface FlatBlock {
  id: string;
  text: string;
}

/** Every block in document order, children included. */
export function flattenBlocks(blocks: unknown[]): FlatBlock[] {
  const out: FlatBlock[] = [];
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const b = raw as BlockLike;
      if (typeof b.id === 'string') out.push({ id: b.id, text: inlineText(b.content) });
      walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

const hasText = (block: FlatBlock) => block.text.trim().length > 0;

/**
 * Gives a time to every block that has text but no time yet. Returns the same object when
 * nothing changed, so callers can skip work. Times are never removed here: undo can bring a
 * block back with its old id, and it should keep its old time.
 */
export function assignBlockTimes(
  times: Record<string, BlockTime>,
  blocks: unknown[],
  nowMs: number,
): Record<string, BlockTime> {
  let next: Record<string, BlockTime> | null = null;
  for (const block of flattenBlocks(blocks)) {
    if (!hasText(block) || times[block.id]) continue;
    next ??= { ...times };
    next[block.id] = { atMs: Math.max(0, Math.round(nowMs)), kind: 'note' };
  }
  return next ?? times;
}

/** Ids of blocks that need a time (have text, no time yet). */
export function blocksNeedingTimes(times: Record<string, BlockTime>, blocks: unknown[]): string[] {
  return flattenBlocks(blocks)
    .filter((b) => hasText(b) && !times[b.id])
    .map((b) => b.id);
}

/** Drops times of blocks that are no longer in the document (done when saving). */
export function pruneBlockTimes(times: Record<string, BlockTime>, blocks: unknown[]): Record<string, BlockTime> {
  const ids = new Set(flattenBlocks(blocks).map((b) => b.id));
  return Object.fromEntries(Object.entries(times).filter(([id]) => ids.has(id)));
}

/** The part of the recording a block refers to. */
export function blockTimeRange(time: BlockTime): TimeRange {
  if (time.kind === 'bookmark') {
    return {
      startMs: Math.max(0, time.atMs - BOOKMARK_BEFORE_MS),
      endMs: time.atMs + BOOKMARK_AFTER_MS,
    };
  }
  return { startMs: Math.max(0, time.atMs - NOTE_LOOKBACK_MS), endMs: time.atMs };
}

/** Bookmarks as anchor entries, for highlighting the transcript. */
export function bookmarkAnchors(doc: NotesDocument) {
  return Object.entries(doc.times)
    .filter(([, t]) => t.kind === 'bookmark')
    .map(([id, t]) => ({ id, kind: 'bookmark' as const, ...blockTimeRange(t) }));
}

export function isNotesDocumentEmpty(doc: NotesDocument): boolean {
  return !flattenBlocks(doc.blocks).some(hasText);
}

/** Parses a stored document defensively; invalid parts become empty. */
export function normalizeNotesDocument(raw: unknown): NotesDocument {
  if (!raw || typeof raw !== 'object') return { version: 1, blocks: [], times: {} };
  const r = raw as { blocks?: unknown; times?: unknown };
  const times: Record<string, BlockTime> = {};
  if (r.times && typeof r.times === 'object') {
    for (const [id, value] of Object.entries(r.times as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as { atMs?: unknown; kind?: unknown; quotedText?: unknown };
      if (typeof v.atMs !== 'number' || !Number.isFinite(v.atMs) || v.atMs < 0) continue;
      times[id] = {
        atMs: Math.round(v.atMs),
        kind: v.kind === 'bookmark' ? 'bookmark' : 'note',
        quotedText: typeof v.quotedText === 'string' ? v.quotedText : null,
      };
    }
  }
  return { version: 1, blocks: Array.isArray(r.blocks) ? r.blocks : [], times };
}

/**
 * Which block times to show in the gutter without hovering: the first block, every bookmark,
 * and any block written at least `gapMs` after the last shown time. Showing every time would
 * turn a page of notes into a column of numbers.
 */
export function visibleTimeIds(
  doc: NotesDocument,
  gapMs = 60_000,
): Set<string> {
  const shown = new Set<string>();
  let lastShownMs: number | null = null;
  for (const block of flattenBlocks(doc.blocks)) {
    const time = doc.times[block.id];
    if (!time) continue;
    if (time.kind === 'bookmark' || lastShownMs === null || time.atMs - lastShownMs >= gapMs) {
      shown.add(block.id);
      lastShownMs = time.atMs;
    }
  }
  return shown;
}
