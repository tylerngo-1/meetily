/**
 * The free-form notes document taken during a meeting: the editor's blocks plus the recording
 * time of each bookmark. Pure logic, no editor or Tauri access. See
 * docs/plans/meeting-prep-and-live-notes.md, section 4.3.
 *
 * Only bookmarks have a time. Ordinary notes are plain text: people go back and add to earlier
 * points, so the moment a line was typed says little about what it refers to.
 */

import { BOOKMARK_AFTER_MS, BOOKMARK_BEFORE_MS, type TimeRange } from '@/lib/note-anchors';

export interface BlockTime {
  /** When the bookmark key was pressed, ms on the recording clock. */
  atMs: number;
  kind: 'bookmark';
  /** Transcript text around a bookmark when it was made; shown as a hint, kept for the summary. */
  quotedText?: string | null;
}

export interface NotesDocument {
  version: 1;
  /** Editor blocks as produced by BlockNote (`editor.document`). Opaque here. */
  blocks: unknown[];
  /** Bookmark times by block id. */
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

/** Drops times of blocks that are no longer in the document (done when saving). */
export function pruneBlockTimes(times: Record<string, BlockTime>, blocks: unknown[]): Record<string, BlockTime> {
  const ids = new Set(flattenBlocks(blocks).map((b) => b.id));
  return Object.fromEntries(Object.entries(times).filter(([id]) => ids.has(id)));
}

/** The part of the recording a bookmark refers to: what was just said. */
export function blockTimeRange(time: BlockTime): TimeRange {
  return {
    startMs: Math.max(0, time.atMs - BOOKMARK_BEFORE_MS),
    endMs: time.atMs + BOOKMARK_AFTER_MS,
  };
}

/** Bookmarks as anchor entries, for highlighting the transcript. */
export function bookmarkAnchors(doc: NotesDocument) {
  return Object.entries(doc.times).map(([id, t]) => ({ id, kind: 'bookmark' as const, ...blockTimeRange(t) }));
}

export function isNotesDocumentEmpty(doc: NotesDocument): boolean {
  return !flattenBlocks(doc.blocks).some(hasText);
}

/**
 * Parses a stored document defensively; invalid parts become empty. Times of plain lines,
 * written by an earlier build that timed every line, are dropped.
 */
export function normalizeNotesDocument(raw: unknown): NotesDocument {
  if (!raw || typeof raw !== 'object') return { version: 1, blocks: [], times: {} };
  const r = raw as { blocks?: unknown; times?: unknown };
  const times: Record<string, BlockTime> = {};
  if (r.times && typeof r.times === 'object') {
    for (const [id, value] of Object.entries(r.times as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as { atMs?: unknown; kind?: unknown; quotedText?: unknown };
      if (v.kind !== 'bookmark') continue;
      if (typeof v.atMs !== 'number' || !Number.isFinite(v.atMs) || v.atMs < 0) continue;
      times[id] = {
        atMs: Math.round(v.atMs),
        kind: 'bookmark',
        quotedText: typeof v.quotedText === 'string' ? v.quotedText : null,
      };
    }
  }
  return { version: 1, blocks: Array.isArray(r.blocks) ? r.blocks : [], times };
}

/** Number of lines with text; shown to the user as "N notes". */
export function countNoteLines(doc: NotesDocument): number {
  return flattenBlocks(doc.blocks).filter(hasText).length;
}

/** JSON stored in `meeting_notes.notes_json`. Times of deleted blocks are dropped. */
export function serializeNotesDocument(doc: NotesDocument): string {
  return JSON.stringify({ ...doc, times: pruneBlockTimes(doc.times, doc.blocks) });
}

/**
 * Reads `meeting_notes.notes_json`. Returns null when it is missing or unreadable, so the
 * caller can fall back to the markdown copy instead of overwriting it with an empty page.
 */
export function parseNotesJson(json: string | null | undefined): NotesDocument | null {
  if (!json) return null;
  try {
    return normalizeNotesDocument(JSON.parse(json));
  } catch {
    return null;
  }
}
