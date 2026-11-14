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
  assignBlockTimes,
  blocksNeedingTimes,
  visibleTimeIds,
  type BlockTime,
  type NotesDocument,
} from '@/lib/notes-document';

const SAVE_DEBOUNCE_MS = 400;

export interface NotesEditorHandle {
  /** Inserts a bookmark line at `atMs` below the current line, and puts the cursor after it. */
  insertBookmark: (atMs: number, quotedText: string | null) => void;
  focus: () => void;
}

interface NotesEditorProps {
  /** Filled with the editor's handle. A prop, not `ref`: next/dynamic does not forward refs. */
  handleRef: React.MutableRefObject<NotesEditorHandle | null>;
  initialDocument: NotesDocument;
  /** Current position on the recording clock; times are only assigned while it resolves. */
  getOffsetMs: () => Promise<number>;
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
 * "1. " numbered list, "[] " checklist, **bold**. Every block remembers when it was first
 * written; times appear in a left gutter and jump to the transcript when clicked.
 *
 * Kept deliberately plain: no drag handles, no slash menu, no block types beyond text.
 */
export default function NotesEditor({
  handleRef,
  initialDocument,
  getOffsetMs,
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
        emptyDocument: 'Write anything. # heading, - list, [] checklist',
        default: '',
      },
    },
    animations: false,
  });

  const timesRef = useRef<Record<string, BlockTime>>(initialDocument.times);
  const [times, setTimes] = useState(initialDocument.times);
  const [labels, setLabels] = useState<GutterLabel[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
      const missing = blocksNeedingTimes(timesRef.current, editor.document);
      if (missing.length > 0) {
        void getOffsetMs().then((now) => {
          const next = assignBlockTimes(timesRef.current, editor.document, now);
          if (next !== timesRef.current) {
            setBlockTimes(next);
            scheduleSave();
          }
        });
      }
      requestAnimationFrame(measureLabels);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [editor, getOffsetMs, measureLabels, scheduleSave, setBlockTimes]);

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

  useImperativeHandle(handleRef, () => ({
    focus: () => editor.focus(),
    insertBookmark: (atMs, quotedText) => {
      const id = newBlockId();
      // Set the time first so the change handler doesn't give the block a plain note time.
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
  }), [editor, scheduleSave, setBlockTimes]);

  const visible = visibleTimeIds({ version: 1, blocks: editor.document, times });

  return (
    <div
      ref={containerRef}
      className="meetily-notes relative h-full overflow-y-auto"
      onScroll={() => setHoveredId(null)}
      onMouseMove={(e) => {
        const block = (e.target as HTMLElement).closest<HTMLElement>('.bn-block-outer[data-id]');
        setHoveredId(block?.dataset.id ?? null);
      }}
      onMouseLeave={() => setHoveredId(null)}
    >
      <div className="pointer-events-none absolute left-0 top-0 w-14">
        {labels.map(({ id, top, time }) => {
          const isBookmark = time.kind === 'bookmark';
          const show = isBookmark || visible.has(id) || hoveredId === id;
          if (!show) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onJumpToTime(time)}
              title={time.quotedText ? `“${time.quotedText}”` : 'Show in transcript'}
              aria-label={`Show transcript at ${formatDuration(time.atMs / 1000)}`}
              style={{ top }}
              className={`pointer-events-auto absolute right-2 rounded px-1 font-mono text-[11px] leading-6 tabular-nums hover:bg-gray-100 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isBookmark ? 'text-blue-600' : hoveredId === id ? 'text-gray-500' : 'text-gray-300'
              }`}
            >
              {formatDuration(time.atMs / 1000)}
            </button>
          );
        })}
      </div>
      <BlockNoteView
        editor={editor}
        theme="light"
        sideMenu={false}
        slashMenu={false}
        filePanel={false}
        tableHandles={false}
        emojiPicker={false}
        className="py-3 pl-14 pr-4"
      />
    </div>
  );
}
