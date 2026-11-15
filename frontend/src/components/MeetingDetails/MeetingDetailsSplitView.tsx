'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { FileText, NotebookPen, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResizableSplit } from '@/hooks/useResizableSplit';

const STORAGE_KEY = 'meetily.meetingDetails.transcriptPaneRatio';
const DEFAULT_RATIO = 0.3;
const MIN_RATIO = 0.3;
const MAX_RATIO = 0.5;

const TABS = [
  { value: 'transcript' as const, label: 'Transcript', icon: FileText },
  { value: 'notes' as const, label: 'Notes', icon: NotebookPen },
  { value: 'summary' as const, label: 'Summary', icon: Sparkles },
];

/**
 * Narrow windows show one tab at a time. On desktop the transcript is always on the left and
 * the right pane shows notes or summary: `transcript` then means "summary on the right".
 */
export type MeetingDetailsTab = 'transcript' | 'notes' | 'summary';

interface MeetingDetailsSplitViewProps {
  transcript: ReactNode;
  notes: ReactNode;
  summary: ReactNode;
  activeTab: MeetingDetailsTab;
  onTabChange: (tab: MeetingDetailsTab) => void;
  /** Dot on the Summary tab: a summary finished while the user was elsewhere. */
  summaryBadge?: boolean;
}

function TabDot() {
  return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-blue-600" />;
}

export function MeetingDetailsSplitView({
  transcript,
  notes,
  summary,
  activeTab,
  onTabChange,
  summaryBadge = false,
}: MeetingDetailsSplitViewProps) {
  const rightTab = activeTab === 'notes' ? 'notes' : 'summary';
  const { containerRef, ratio, isDesktop, containerHandlers, separatorProps } = useResizableSplit({
    storageKey: STORAGE_KEY,
    defaultRatio: DEFAULT_RATIO,
    minRatio: MIN_RATIO,
    maxRatio: MAX_RATIO,
    label: 'Resize transcript and summary',
    firstPaneName: 'Transcript',
  });

  const transcriptPanelProps = isDesktop
    ? { role: 'region' as const, 'aria-label': 'Transcript', tabIndex: -1 }
    : {};
  const summaryPanelProps = isDesktop
    ? { role: 'region' as const, 'aria-label': 'Summary', tabIndex: -1 }
    : {};
  const notesPanelProps = isDesktop
    ? { role: 'region' as const, 'aria-label': 'Notes', tabIndex: -1 }
    : {};

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as MeetingDetailsTab)}
      className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <div className="shrink-0 bg-white px-2 md:hidden">
        <TabsList className="relative h-auto w-full justify-center rounded-none border-b border-gray-200 bg-transparent p-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="relative z-10 flex items-center gap-2 rounded-none border-0 bg-transparent px-4 py-4 text-gray-600 data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:shadow-none hover:text-gray-900"
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.value === 'summary' && summaryBadge && <TabDot />}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 min-w-0 flex-col md:flex-row"
        style={{ '--transcript-pane-width': `${ratio * 100}%` } as CSSProperties}
        {...containerHandlers}
      >
        <TabsContent
          value="transcript"
          forceMount
          className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden md:w-[var(--transcript-pane-width)] md:flex-none md:data-[state=inactive]:flex"
          {...transcriptPanelProps}
        >
          {transcript}
        </TabsContent>
        <div
          {...separatorProps}
          className="group relative z-10 hidden w-2 flex-shrink-0 cursor-col-resize items-stretch justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset md:flex"
        >
          <div className="h-full w-px bg-gray-200 transition-[width,background-color] duration-150 ease-out group-hover:w-1 group-hover:bg-blue-400 group-active:w-1 group-active:bg-blue-500" />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Desktop: switch the right pane between notes and summary. */}
          <div
            role="group"
            aria-label="Right pane"
            className="hidden shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-3 md:flex"
          >
            {TABS.filter((tab) => tab.value !== 'transcript').map((tab) => {
              const Icon = tab.icon;
              const active = rightTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onTabChange(tab.value)}
                  className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                    active
                      ? 'border-blue-600 font-medium text-blue-700'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {tab.value === 'summary' && summaryBadge && <TabDot />}
                </button>
              );
            })}
          </div>
          <TabsContent
            value="notes"
            forceMount
            className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
            {...notesPanelProps}
          >
            {notes}
          </TabsContent>
          <TabsContent
            value="summary"
            forceMount
            className={`mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden ${
              rightTab === 'summary' ? 'md:data-[state=inactive]:flex' : ''
            }`}
            {...summaryPanelProps}
          >
            {summary}
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
