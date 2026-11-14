'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { RecordingControls } from '@/components/RecordingControls';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { StatusOverlays } from '@/app/_components/StatusOverlays';
import Analytics from '@/lib/analytics';
import { SettingsModals } from './_components/SettingsModal';
import { TranscriptPanel } from './_components/TranscriptPanel';
import { useModalState } from '@/hooks/useModalState';
import { useRecordingStateSync } from '@/hooks/useRecordingStateSync';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { TranscriptRecovery } from '@/components/TranscriptRecovery';
import { indexedDBService } from '@/services/indexedDBService';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { LiveNotesPanel, type LiveNotesPanelHandle } from '@/components/LiveNotes/LiveNotesPanel';
import { useLiveNotes } from '@/hooks/useLiveNotes';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { segmentsForRange } from '@/lib/note-anchors';
import type { NoteEntryInput } from '@/services/meetingNotesService';

const NOTES_OPEN_KEY = 'meetily.recording.notesOpen';

function readNotesOpen(): boolean {
  try {
    return localStorage.getItem(NOTES_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export default function Home() {
  // Local page state (not moved to contexts)
  const [isRecording, setIsRecordingState] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);

  // Use contexts for state management
  const { meetingTitle } = useTranscripts();
  const { transcriptModelConfig, selectedDevices } = useConfig();
  const recordingState = useRecordingState();

  // Extract status from global state
  const { status, isStopping, isProcessing, isSaving } = recordingState;

  // Hooks
  const { hasMicrophone } = usePermissionCheck();
  const { setIsMeetingActive, isCollapsed: sidebarCollapsed, refetchMeetings } = useSidebar();
  const { modals, messages, showModal, hideModal } = useModalState(transcriptModelConfig);
  const { isRecordingDisabled, setIsRecordingDisabled } = useRecordingStateSync(isRecording, setIsRecordingState, setIsMeetingActive);
  const { handleRecordingStart } = useRecordingStart(isRecording, setIsRecordingState, showModal);

  // Get handleRecordingStop function and setIsStopping (state comes from global context)
  const { handleRecordingStop, setIsStopping } = useRecordingStop(
    setIsRecordingState,
    setIsRecordingDisabled
  );

  // Recovery hook
  const {
    recoverableMeetings,
    isLoading: isLoadingRecovery,
    isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting
  } = useTranscriptRecovery();

  const router = useRouter();

  // Live notes (docs/plans/meeting-prep-and-live-notes.md, section 6)
  const liveNotes = useLiveNotes();
  const notesPanelRef = useRef<LiveNotesPanelHandle>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{ segmentId: string; nonce: number } | null>(null);
  const split = useResizableSplit({
    storageKey: 'meetily.recording.transcriptPaneRatio',
    defaultRatio: 0.6,
    minRatio: 0.45,
    maxRatio: 0.75,
    label: 'Resize transcript and notes',
    firstPaneName: 'Transcript',
  });
  const showNotes = recordingState.isRecording && notesOpen;
  const isSplit = showNotes && split.isDesktop;

  useEffect(() => setNotesOpen(readNotesOpen()), []);

  const toggleNotes = useCallback(() => {
    setNotesOpen((open) => {
      try {
        localStorage.setItem(NOTES_OPEN_KEY, String(!open));
      } catch {
        // Remembering the pane state is optional.
      }
      return !open;
    });
  }, []);

  const handleBookmark = useCallback(async () => {
    if (!recordingState.isRecording) return;
    Analytics.trackButtonClick('bookmark', 'recording_controls');
    const id = await liveNotes.addBookmark();
    const panel = notesPanelRef.current;
    if (panel && !panel.isComposing()) panel.editEntry(id);
    else if (!panel) toast.success('Bookmarked', { duration: 1500 });
  }, [recordingState.isRecording, liveNotes]);

  const handleJumpToEntry = useCallback((entry: NoteEntryInput) => {
    if (entry.startMs === null) return;
    const range = { startMs: entry.startMs, endMs: entry.endMs ?? entry.startMs };
    const [segment] = segmentsForRange(range, liveNotes.anchorSegments);
    if (!segment) {
      toast.info('No transcript at that time yet');
      return;
    }
    if (!split.isDesktop) setNotesOpen(false); // single pane: show the transcript
    setFocusRequest({ segmentId: segment.id, nonce: Date.now() });
  }, [liveNotes.anchorSegments, split.isDesktop]);

  // ⌘B / Ctrl+B bookmarks, ⌘J / Ctrl+J toggles the notes pane, while recording.
  useEffect(() => {
    if (!recordingState.isRecording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.repeat) return;
      if (e.code === 'KeyB') {
        e.preventDefault();
        void handleBookmark();
      } else if (e.code === 'KeyJ') {
        e.preventDefault();
        toggleNotes();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recordingState.isRecording, handleBookmark, toggleNotes]);

  useEffect(() => {
    // Track page view
    Analytics.trackPageView('home');
  }, []);

  // Startup recovery check
  useEffect(() => {
    const performStartupChecks = async () => {
      try {
        // Skip recovery check if currently recording or processing stop
        // This prevents the recovery dialog from showing when:
        if (recordingState.isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING) {
          console.log('Skipping recovery check - recording in progress or processing');
          return;
        }

        // 1. Clean up old meetings (7+ days)
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (error) {
          console.warn('⚠️ Failed to clean up old meetings:', error);
        }

        // 2. Clean up saved meetings (24+ hours after save)
        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (error) {
          console.warn('⚠️ Failed to clean up saved meetings:', error);
        }

        // 3. Always check for recoverable meetings on startup
        // Don't skip based on sessionStorage - we need to check every time
        await checkForRecoverableTranscripts();
      } catch (error) {
        console.error('Failed to perform startup checks:', error);
      }
    };

    performStartupChecks();
  }, [checkForRecoverableTranscripts, recordingState.isRecording, status]);

  // Watch for recoverable meetings changes and show dialog once per session
  useEffect(() => {
    // Only show dialog if we have meetings and haven't shown it yet this session
    if (recoverableMeetings.length > 0) {
      const shownThisSession = sessionStorage.getItem('recovery_dialog_shown');
      if (!shownThisSession) {
        setShowRecoveryDialog(true);
        sessionStorage.setItem('recovery_dialog_shown', 'true');
      }
    }
  }, [recoverableMeetings]);

  // Handle recovery with toast notifications and navigation
  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);

      if (result.success) {
        toast.success('Meeting recovered successfully!', {
          description: result.audioRecoveryStatus?.status === 'success'
            ? 'Transcripts and audio recovered'
            : 'Transcripts recovered (no audio available)',
          action: result.meetingId ? {
            label: 'View Meeting',
            onClick: () => {
              router.push(`/meeting-details?id=${result.meetingId}`);
            }
          } : undefined,
          duration: 10000,
        });

        // Refresh sidebar to show the newly recovered meeting
        await refetchMeetings();

        // If no more recoverable meetings, clear session flag so dialog can show again
        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem('recovery_dialog_shown');
        }

        // Auto-navigate after a short delay
        if (result.meetingId) {
          setTimeout(() => {
            router.push(`/meeting-details?id=${result.meetingId}`);
          }, 2000);
        }
      }
    } catch (error) {
      toast.error('Failed to recover meeting', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      throw error;
    }
  };

  // Handle dialog close - clear session flag if no meetings left
  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    // If user closes dialog and there are no more meetings, clear the flag
    // This allows the dialog to show again next session if new meetings appear
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem('recovery_dialog_shown');
    }
  };

  // Computed values using global status
  const isProcessingStop = status === RecordingStatus.PROCESSING_TRANSCRIPTS || isProcessing;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* All Modals supported*/}
      <SettingsModals
        modals={modals}
        messages={messages}
        onClose={hideModal}
      />

      {/* Recovery Dialog */}
      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />
      <div className="flex flex-1 overflow-hidden">
        <div
          ref={split.containerRef}
          className="flex min-w-0 flex-1"
          style={{ '--transcript-pane-width': `${split.ratio * 100}%` } as CSSProperties}
          {...(isSplit ? split.containerHandlers : {})}
        >
          <div
            className={
              isSplit ? 'flex min-w-0 flex-none w-[var(--transcript-pane-width)]'
              : showNotes ? 'hidden'
              : 'flex min-w-0 flex-1'
            }
          >
            <TranscriptPanel
              isProcessingStop={isProcessingStop}
              isStopping={isStopping}
              showModal={showModal}
              isSplit={isSplit}
              notesOpen={showNotes}
              onToggleNotes={toggleNotes}
              segmentMarks={liveNotes.segmentMarks}
              focusRequest={focusRequest}
            />
          </div>
          {isSplit && (
            <div
              {...split.separatorProps}
              className="group relative z-10 flex w-2 flex-shrink-0 cursor-col-resize items-stretch justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
            >
              <div className="h-full w-px bg-gray-200 transition-[width,background-color] duration-150 ease-out group-hover:w-1 group-hover:bg-blue-400 group-active:w-1 group-active:bg-blue-500" />
            </div>
          )}
          {showNotes && (
            <div className={`flex min-w-0 flex-1 flex-col ${isSplit ? '' : 'pb-32'}`}>
              <LiveNotesPanel
                ref={notesPanelRef}
                liveNotes={liveNotes}
                onJumpToEntry={handleJumpToEntry}
                onClose={toggleNotes}
              />
            </div>
          )}
        </div>

        {/* Recording controls - only show when permissions are granted or already recording and not showing status messages */}
        {(hasMicrophone || isRecording) &&
          status !== RecordingStatus.PROCESSING_TRANSCRIPTS &&
          status !== RecordingStatus.SAVING && (
            <div
              className="fixed bottom-12 left-0 z-10 transition-[right] duration-300"
              style={{
                // Centered under the transcript; the notes pane keeps its own composer clear.
                right: isSplit
                  ? `calc((100vw - ${sidebarCollapsed ? '4rem' : '16rem'}) * ${1 - split.ratio})`
                  : 0,
              }}
            >
              <div
                className="flex justify-center pl-8 transition-[margin] duration-300"
                style={{
                  marginLeft: sidebarCollapsed ? '4rem' : '16rem'
                }}
              >
                <div className={`${isSplit ? 'w-full px-4' : 'w-2/3'} max-w-[750px] flex justify-center`}>
                  <RecordingControls
                    isRecording={recordingState.isRecording}
                    onRecordingStop={(callApi = true) => handleRecordingStop(callApi)}
                    onRecordingStart={handleRecordingStart}
                    onTranscriptReceived={() => { }} // Not actually used by RecordingControls
                    onStopInitiated={() => setIsStopping(true)}
                    onTranscriptionError={(message) => {
                      showModal('errorAlert', message);
                    }}
                    isRecordingDisabled={isRecordingDisabled}
                    isParentProcessing={isProcessingStop}
                    selectedDevices={selectedDevices}
                    meetingName={meetingTitle}
                    onBookmark={() => void handleBookmark()}
                  />
                </div>
              </div>
            </div>
          )}

        {/* Status Overlays - Processing and Saving */}
        <StatusOverlays
          isProcessing={status === RecordingStatus.PROCESSING_TRANSCRIPTS && !recordingState.isRecording}
          isSaving={status === RecordingStatus.SAVING}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
    </div>
  );
}
