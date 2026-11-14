'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Bookmark, Check, PanelRightClose, Trash2 } from 'lucide-react';
import { formatDuration } from '@/lib/format-duration';
import { matchSlashCommands, parseNoteInput, type SlashCommand } from '@/lib/note-anchors';
import type { NoteEntryInput, NoteTag } from '@/services/meetingNotesService';
import type { LiveNotes } from '@/hooks/useLiveNotes';

const TAG_STYLES: Record<NoteTag, { label: string; className: string }> = {
  action: { label: 'Action', className: 'bg-green-50 text-green-700 ring-green-200' },
  decision: { label: 'Decision', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  question: { label: 'Question', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

const MAX_COMPOSER_HEIGHT_PX = 144;

export interface LiveNotesPanelHandle {
  /** Opens the text of an entry (used right after a bookmark is added). */
  editEntry: (id: string) => void;
  /** True when the composer holds unsent text, so a bookmark should not steal focus. */
  isComposing: () => boolean;
}

interface LiveNotesPanelProps {
  liveNotes: LiveNotes;
  onJumpToEntry: (entry: NoteEntryInput) => void;
  onClose: () => void;
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
}

function TagChip({ tag }: { tag: NoteTag }) {
  const style = TAG_STYLES[tag];
  return (
    <span className={`inline-flex flex-shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ring-1 ring-inset ${style.className}`}>
      {style.label}
    </span>
  );
}

function EntryText({
  value,
  isEditing,
  placeholder,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  value: string;
  isEditing: boolean;
  placeholder: string;
  onStartEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [draftText, setDraftText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  // A blur fired as the textarea unmounts after Enter/Escape must not commit again.
  const activeRef = useRef(false);

  useEffect(() => {
    if (!isEditing) return;
    activeRef.current = true;
    setDraftText(value);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      autoGrow(el);
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    // Only when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const finish = (commit: boolean) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (commit) onCommit(draftText.trim());
    else onCancel();
  };

  if (isEditing) {
    return (
      <textarea
        ref={ref}
        value={draftText}
        rows={1}
        aria-label="Edit note"
        onChange={(e) => {
          setDraftText(e.target.value);
          autoGrow(e.target);
        }}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            finish(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
          }
        }}
        className="w-full resize-none rounded-md border border-gray-300 bg-white px-2 py-1 text-sm leading-6 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onStartEdit}
      className="w-full whitespace-pre-wrap break-words rounded-md px-1 text-left text-sm leading-6 text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {value || <span className="italic text-gray-400">{placeholder}</span>}
    </button>
  );
}

/**
 * LiveNotesPanel
 *
 * Notes pane shown next to the transcript while recording: agenda checklist, timestamped
 * notes and bookmarks, and a composer with slash commands.
 */
export const LiveNotesPanel = forwardRef<LiveNotesPanelHandle, LiveNotesPanelProps>(function LiveNotesPanel(
  { liveNotes, onJumpToEntry, onClose },
  ref,
) {
  const { agenda, notes, addFromInput, toggleAgendaItem, updateEntry, removeEntry, getOffsetMs } = liveNotes;
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  /** Offset when the user started typing the current note. */
  const firstKeystrokeRef = useRef<Promise<number> | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const suggestions = matchSlashCommands(input);
  const menuOpen = suggestions.length > 0;

  useImperativeHandle(ref, () => ({
    editEntry: (id: string) => setEditingId(id),
    isComposing: () => inputRef.current.trim().length > 0,
  }), []);

  // Focus the composer when the pane opens, so typing starts a note right away.
  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // Keep the newest note in view.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [notes.length]);

  useEffect(() => setMenuIndex(0), [suggestions.length]);

  const onInputChange = (value: string) => {
    // The note's time is when its text (after any /command) started, not when Enter is pressed.
    const hadText = parseNoteInput(inputRef.current).text.length > 0;
    const hasText = parseNoteInput(value).text.length > 0;
    if (!hasText) firstKeystrokeRef.current = null;
    else if (!hadText || !firstKeystrokeRef.current) firstKeystrokeRef.current = getOffsetMs();
    setInput(value);
  };

  const applySuggestion = (command: SlashCommand) => {
    setInput(`/${command.command} `);
    // The note itself starts after the command.
    firstKeystrokeRef.current = null;
    composerRef.current?.focus();
  };

  const commit = useCallback(async () => {
    const text = inputRef.current;
    if (!text.trim()) return;
    const pending = firstKeystrokeRef.current;
    setInput('');
    firstKeystrokeRef.current = null;
    requestAnimationFrame(() => autoGrow(composerRef.current));
    const firstKeystroke = pending ? await pending.catch(() => null) : null;
    const added = await addFromInput(text, firstKeystroke);
    if (!added) setInput(text);
  }, [addFromInput]);

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // IME (e.g. Vietnamese Telex) still composing

    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setMenuIndex((i) => (i + delta + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[menuIndex]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input) setInput('');
      else composerRef.current?.blur();
    } else if (e.key === 'ArrowUp' && !input) {
      const last = notes[notes.length - 1];
      if (last) {
        e.preventDefault();
        setEditingId(last.id);
      }
    }
  };

  const finishEditing = () => {
    setEditingId(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <section aria-label="Your notes" className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Your notes</h2>
          <p className="text-xs text-gray-500">Saved with this meeting, with the time you wrote them</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide notes"
          title="Hide notes (⌘J)"
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {agenda.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Agenda</h3>
            <ul>
              {agenda.map((item) => (
                <li key={item.id} className="group flex items-start gap-2 py-1">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.done}
                    aria-label={`${item.done ? 'Uncheck' : 'Check'} ${item.text}`}
                    onClick={() => void toggleAgendaItem(item.id)}
                    className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${item.done ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'}`}
                  >
                    {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
                  </button>
                  <div className={`min-w-0 flex-1 ${item.done ? 'text-gray-400 line-through' : ''}`}>
                    <EntryText
                      value={item.text}
                      isEditing={editingId === item.id}
                      placeholder="Agenda item"
                      onStartEdit={() => setEditingId(item.id)}
                      onCommit={(text) => {
                        if (text) updateEntry(item.id, { text });
                        else removeEntry(item.id);
                        finishEditing();
                      }}
                      onCancel={finishEditing}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEntry(item.id)}
                    aria-label={`Delete agenda item ${item.text}`}
                    className="mt-1 rounded p-0.5 text-gray-400 opacity-0 hover:text-red-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {notes.length === 0 ? (
          <div className="mt-6 text-center text-sm text-gray-500">
            <p>Type a note and press Enter.</p>
            <p className="mt-1 text-xs text-gray-400">
              Start with / to tag it as an action, decision or question. Press ⌘B to bookmark what was just said.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {notes.map((entry) => (
              <li key={entry.id} className="group flex items-start gap-2 py-1">
                <button
                  type="button"
                  onClick={() => onJumpToEntry(entry)}
                  disabled={entry.startMs === null}
                  aria-label={entry.startMs === null ? undefined : `Show transcript at ${formatDuration(entry.startMs / 1000)}`}
                  title="Show in transcript"
                  className="mt-1 w-12 flex-shrink-0 rounded text-right font-mono text-xs tabular-nums text-gray-400 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:hover:text-gray-400"
                >
                  {entry.startMs === null ? '' : formatDuration(entry.startMs / 1000)}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5">
                    {entry.kind === 'bookmark' && (
                      <Bookmark className="mt-1.5 h-3.5 w-3.5 flex-shrink-0 text-blue-600" aria-label="Bookmark" />
                    )}
                    {entry.tag && <span className="mt-1"><TagChip tag={entry.tag} /></span>}
                    <div className="min-w-0 flex-1">
                      <EntryText
                        value={entry.text}
                        isEditing={editingId === entry.id}
                        placeholder={entry.kind === 'bookmark' ? 'Add a note to this bookmark' : 'Empty note'}
                        onStartEdit={() => setEditingId(entry.id)}
                        onCommit={(text) => {
                          // Bookmarks stay without text; empty notes are removed.
                          if (text || entry.kind === 'bookmark') updateEntry(entry.id, { text });
                          else removeEntry(entry.id);
                          finishEditing();
                        }}
                        onCancel={finishEditing}
                      />
                    </div>
                  </div>
                  {entry.kind === 'bookmark' && entry.quotedText && (
                    <p className="ml-5 mt-0.5 line-clamp-2 text-xs text-gray-500">“{entry.quotedText}”</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  aria-label="Delete note"
                  className="mt-1 rounded p-0.5 text-gray-400 opacity-0 hover:text-red-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div ref={listEndRef} />
      </div>

      <div className="relative border-t border-gray-100 p-3">
        {menuOpen && (
          <ul
            role="listbox"
            aria-label="Note commands"
            className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {suggestions.map((command, index) => (
              <li
                key={command.command}
                role="option"
                aria-selected={index === menuIndex}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the composer
                  applySuggestion(command);
                }}
                onMouseEnter={() => setMenuIndex(index)}
                className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm ${index === menuIndex ? 'bg-gray-100' : ''}`}
              >
                <span className="font-mono text-gray-900">/{command.command}</span>
                <span className="text-xs text-gray-500">{command.description}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={composerRef}
          value={input}
          rows={1}
          aria-label="New note"
          placeholder="Type a note… / for commands"
          onChange={(e) => {
            onInputChange(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={onComposerKeyDown}
          className="block w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </section>
  );
});
