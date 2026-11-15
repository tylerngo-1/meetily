'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { useMeetingDraft } from '@/contexts/MeetingDraftContext';
import { meetingNotesService } from '@/services/meetingNotesService';
import { NotesEditorLazy as NotesEditor } from '@/components/LiveNotes/NotesEditorLazy';
import type { NotesDocument } from '@/lib/notes-document';

/** Remembered so the next meeting starts with the type used last. */
export const LAST_TEMPLATE_KEY = 'meetily.lastTemplateId';
const MAX_TITLE_LENGTH = 200;
const MAX_PEOPLE = 50;

interface TemplateOption {
  id: string;
  name: string;
}

function readLastTemplate(): string | null {
  try {
    return localStorage.getItem(LAST_TEMPLATE_KEY);
  } catch {
    return null;
  }
}

/**
 * MeetingPrepPanel
 *
 * Home, before recording: an optional title, meeting type, people, and the notes page (agenda,
 * questions, anything). Nothing here is required, and the notes page is the same one that
 * continues while recording. Everything lives in the meeting draft and is saved with the
 * meeting after it stops. See docs/plans/meeting-prep-and-live-notes.md, section 5.
 */
export function MeetingPrepPanel() {
  const { draft, updateDraft, isHydrated } = useMeetingDraft();
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [personInput, setPersonInput] = useState('');
  const ids = { title: useId(), type: useId(), people: useId(), peopleList: useId() };

  useEffect(() => {
    invoke<TemplateOption[]>('api_list_templates')
      .then(setTemplates)
      .catch((error) => console.warn('[MeetingPrep] Could not load meeting types:', error));
    meetingNotesService
      .listPeople()
      .then((list) => setPeople(list.map((p) => p.name)))
      .catch((error) => console.warn('[MeetingPrep] Could not load people:', error));
  }, []);

  // Start with the type used last, once the stored draft has loaded.
  useEffect(() => {
    if (!isHydrated || draft.templateId) return;
    const last = readLastTemplate();
    if (last) updateDraft({ templateId: last });
    // Only when the draft first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  const setTemplate = (templateId: string) => {
    updateDraft({ templateId: templateId || null });
    try {
      if (templateId) localStorage.setItem(LAST_TEMPLATE_KEY, templateId);
    } catch {
      // Remembering the type is optional.
    }
  };

  const addPerson = (raw: string) => {
    const name = raw.trim().replace(/,$/, '').trim();
    setPersonInput('');
    if (!name) return;
    const exists = draft.participants.some((p) => p.toLowerCase() === name.toLowerCase());
    if (exists || draft.participants.length >= MAX_PEOPLE) return;
    updateDraft({ participants: [...draft.participants, name] });
  };

  const removePerson = (name: string) =>
    updateDraft({ participants: draft.participants.filter((p) => p !== name) });

  // Prep notes are kept only while the draft is still in prep: once recording starts the
  // recording's notes pane owns the document.
  const saveNotes = useCallback(
    (notes: NotesDocument, notesMarkdown: string) =>
      updateDraft((current) => (current.phase === 'prep' ? { notes, notesMarkdown } : {})),
    [updateDraft],
  );

  if (!isHydrated) return null;

  const suggestions = people.filter((name) => !draft.participants.includes(name));

  return (
    <section aria-labelledby={ids.title} className="mx-auto mt-6 w-full max-w-[750px] px-2">
      <input
        id={ids.title}
        value={draft.title}
        maxLength={MAX_TITLE_LENGTH}
        onChange={(e) => updateDraft({ title: e.target.value })}
        placeholder="Untitled meeting"
        aria-label="Meeting title"
        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-xl font-semibold text-gray-900 placeholder:text-gray-400 hover:border-gray-200 focus:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />
      <p className="px-1 text-xs text-gray-500">
        Everything here is optional. Press <kbd className="font-sans">⌘R</kbd> or the record button to start.
      </p>

      <dl className="mt-4 grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
        <dt>
          <label htmlFor={ids.type} className="text-gray-500">Type</label>
        </dt>
        <dd>
          <select
            id={ids.type}
            value={draft.templateId ?? ''}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full max-w-xs rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="">Standard meeting</option>
            {templates
              .filter((t) => t.id !== 'standard_meeting')
              .map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
          </select>
        </dd>

        <dt>
          <label htmlFor={ids.people} className="text-gray-500">People</label>
        </dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {draft.participants.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2.5 pr-1 text-gray-800">
              {name}
              <button
                type="button"
                onClick={() => removePerson(name)}
                aria-label={`Remove ${name}`}
                className="rounded-full p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            id={ids.people}
            list={ids.peopleList}
            value={personInput}
            onChange={(e) => {
              const value = e.target.value;
              if (value.endsWith(',')) addPerson(value);
              else setPersonInput(value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPerson(personInput);
              } else if (e.key === 'Backspace' && !personInput && draft.participants.length > 0) {
                removePerson(draft.participants[draft.participants.length - 1]);
              }
            }}
            onBlur={() => addPerson(personInput)}
            placeholder={draft.participants.length === 0 ? 'Add a name' : 'Add'}
            className="min-w-[8rem] flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm text-gray-900 placeholder:text-gray-400 hover:border-gray-200 focus:border-gray-300 focus:outline-none"
          />
          <datalist id={ids.peopleList}>
            {suggestions.map((name) => <option key={name} value={name} />)}
          </datalist>
        </dd>
      </dl>

      <div className="mt-5 border-t border-gray-100 pt-3">
        <h2 className="px-1 text-sm font-medium text-gray-700">Notes</h2>
        <p className="px-1 text-xs text-gray-500">
          Agenda, questions, anything. This page stays open while you record.
        </p>
        <div className="mt-1 min-h-[8rem]">
          <NotesEditor
            initialDocument={draft.notes}
            gutter={false}
            placeholder="Write an agenda or anything to prepare. [] makes a checklist."
            onChange={saveNotes}
            onJumpToTime={() => {}}
          />
        </div>
      </div>
    </section>
  );
}
