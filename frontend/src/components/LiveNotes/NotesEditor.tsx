'use client';

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import '@blocknote/core/fonts/inter.css';
import { formatDuration } from '@/lib/format-duration';
import {
  BOOKMARK_PREFIX,
  type BlockTime,
  type NotesDocument,
} from '@/lib/notes-document';

const SAVE_DEBOUNCE_MS = 400;

export interface NotesEditorHandle {
  /** Inserts a bookmark line at `atMs` below the current line, and puts the cursor after it. */
  insertBookmark: (atMs: number, quotedText: string | null) => void;
  focus: () => void;
  /** Saves pending edits now instead of after the debounce. */
  flush: () => Promise<void>;
}

interface NotesEditorProps {
  /** Filled with the editor's handle. A prop, not `ref`: next/dynamic does not forward refs. */
  handleRef?: React.MutableRefObject<NotesEditorHandle | null>;
  initialDocument: NotesDocument;
  /** Used only when `initialDocument` is empty (e.g. its JSON could not be read). */
  initialMarkdown?: string | null;
  /** Shows the notes without letting them change (e.g. while the meeting is being saved). */
  readOnly?: boolean;
  /** Left gutter for bookmark times. Off where there can be no bookmarks yet (before recording). */
  gutter?: boolean;
  /** Text shown on the empty page. */
  placeholder?: string;
  onChange: (doc: NotesDocument, markdown: string) => void;
  onJumpToTime: (time: BlockTime) => void;
}

function newBlockId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

interface GutterLabel {
  id: string;
  top: number;
  time: BlockTime;
}

/**
 * Free-form notes editor (BlockNote) with markdown shortcuts: "# " heading, "- " list,
 * "1. " numbered list, "[] " checklist, **bold**. Plain notes have no time; only
 * bookmarks (⌘B) do, shown in a left gutter, and clicking one jumps to the transcript.
 *
 * Kept deliberately plain: no drag handles, no slash menu, no block types beyond text.
 */
export default function NotesEditor({
  handleRef,
  initialDocument,
  initialMarkdown,
  readOnly = false,
  gutter = true,
  placeholder = 'Write anything. # heading, - list, [] checklist',
  onChange,
  onJumpToTime,
}: NotesEditorProps) {
  const editor = useCreateBlockNote({
    initialContent:
      initialDocument.blocks.length > 0 ? (initialDocument.blocks as PartialBlock[]) : undefined,
    dictionary: {
      ...en,
      placeholders: {
        ...en.placeholders,
        emptyDocument: placeholder,
        default: '',
      },
    },
    animations: false,
  });

  const timesRef = useRef<Record<string, BlockTime>>(initialDocument.times);
  const [times, setTimes] = useState(initialDocument.times);
  const [labels, setLabels] = useState<GutterLabel[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Fallback: build the page from the markdown copy so a save never replaces it with nothing.
  useEffect(() => {
    if (initialDocument.blocks.length > 0 || !initialMarkdown?.trim()) return;
    void (async () => {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
        if (blocks.length > 0) editor.replaceBlocks(editor.document, blocks);
      } catch (error) {
        console.warn('[NotesEditor] Could not read notes markdown:', error);
      }
    })();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const setBlockTimes = useCallback((next: Record<string, BlockTime>) => {
    timesRef.current = next;
    setTimes(next);
  }, []);

  const save = useCallback(async () => {
    saveTimerRef.current = null;
    const blocks = editor.document;
    let markdown = '';
    try {
      markdown = await editor.blocksToMarkdownLossy(blocks);
    } catch (error) {
      console.warn('[NotesEditor] Markdown export failed:', error);
    }
    onChangeRef.current({ version: 1, blocks, times: timesRef.current }, markdown);
  }, [editor]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  }, [save]);

  // Save pending edits when the pane closes (⌘J) or the page changes.
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      void save();
    }
  }, [save]);

  const measureLabels = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect().top - container.scrollTop;
    const next: GutterLabel[] = [];
    container.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]').forEach((el) => {
      const id = el.dataset.id;
      const time = id ? timesRef.current[id] : undefined;
      if (!id || !time) return;
      const content = el.querySelector<HTMLElement>('.bn-block-content') ?? el;
      next.push({ id, top: content.getBoundingClientRect().top - base, time });
    });
    setLabels(next);
  }, []);

  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      scheduleSave();
      requestAnimationFrame(measureLabels);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [editor, measureLabels, scheduleSave]);

  // Re-measure when times change or the pane is resized (text re-wraps).
  useLayoutEffect(() => {
    measureLabels();
  }, [times, measureLabels]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measureLabels());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureLabels]);

  useImperativeHandle(handleRef ?? { current: null }, () => ({
    focus: () => editor.focus(),
    flush: async () => {
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      await save();
    },
    insertBookmark: (atMs, quotedText) => {
      const id = newBlockId();
      // Set the time first so the gutter can place it as soon as the block renders.
      setBlockTimes({ ...timesRef.current, [id]: { atMs, kind: 'bookmark', quotedText } });

      const bookmark: PartialBlock = { id, type: 'paragraph', content: BOOKMARK_PREFIX };
      let current;
      try {
        current = editor.getTextCursorPosition().block;
      } catch {
        current = editor.document[editor.document.length - 1];
      }
      const isEmptyLine =
        current && current.type === 'paragraph' && Array.isArray(current.content) && current.content.length === 0;

      if (current && isEmptyLine) {
        editor.replaceBlocks([current], [bookmark]);
      } else if (current) {
        editor.insertBlocks([bookmark], current, 'after');
      } else {
        editor.replaceBlocks(editor.document, [bookmark]);
      }
      editor.setTextCursorPosition(id, 'end');
      editor.focus();
      scheduleSave();
    },
  }), [editor, save, scheduleSave, setBlockTimes]);

  return (
    <div ref={containerRef} className="meetily-notes relative h-full overflow-y-auto">
      <div className="pointer-events-none absolute left-0 top-0 w-14">
        {labels.map(({ id, top, time }) => (
          <button
            key={id}
            type="button"
            onClick={() => onJumpToTime(time)}
            title={time.quotedText ? `“${time.quotedText}”` : 'Show in transcript'}
            aria-label={`Show transcript at ${formatDuration(time.atMs / 1000)}`}
            style={{ top }}
            className="pointer-events-auto absolute right-2 rounded px-1 font-mono text-[11px] leading-6 tabular-nums text-blue-600 hover:bg-gray-100 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {formatDuration(time.atMs / 1000)}
          </button>
        ))}
      </div>
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        theme="light"
        sideMenu={false}
        slashMenu={false}
        filePanel={false}
        tableHandles={false}
        emojiPicker={false}
        className={gutter ? 'py-3 pl-14 pr-4' : 'px-0 py-2'}
      />
    </div>
  );
}
