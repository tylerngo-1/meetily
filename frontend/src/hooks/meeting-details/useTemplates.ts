import { useState, useEffect, useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { meetingNotesService } from '@/services/meetingNotesService';

const DEFAULT_TEMPLATE = 'standard_meeting';

/**
 * Summary templates, and the meeting's own type (`meetings.template_id`, set on home before
 * recording). Choosing a template here saves it as the meeting's type.
 */
export function useTemplates(meetingId?: string) {
  const [availableTemplates, setAvailableTemplates] = useState<Array<{
    id: string;
    name: string;
    description: string;
  }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(DEFAULT_TEMPLATE);
  /** False until the meeting's type is known; summary generation waits for it. */
  const [isTemplateLoaded, setIsTemplateLoaded] = useState(!meetingId);

  // Fetch available templates on mount
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const templates = await invokeTauri('api_list_templates') as Array<{
          id: string;
          name: string;
          description: string;
        }>;
        setAvailableTemplates(templates);
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      }
    };
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    setIsTemplateLoaded(false);
    meetingNotesService
      .getMeetingPrep(meetingId)
      .then((prep) => {
        if (!cancelled && prep.templateId) setSelectedTemplate(prep.templateId);
      })
      .catch((error) => console.warn('Could not load the meeting type:', error))
      .finally(() => {
        if (!cancelled) setIsTemplateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // Handle template selection
  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    toast.success('Template selected', {
      description: `Using "${templateName}" template for summary generation`,
    });
    Analytics.trackFeatureUsed('template_selected');
    if (meetingId) {
      // Keep the other prep fields as they are.
      void meetingNotesService
        .getMeetingPrep(meetingId)
        .then((prep) =>
          meetingNotesService.setMeetingPrep(meetingId, {
            templateId,
            prepContext: prep.prepContext,
            seriesId: prep.seriesId,
          }),
        )
        .catch((error) => console.warn('Could not save the meeting type:', error));
    }
  }, [meetingId]);

  return {
    availableTemplates,
    selectedTemplate,
    isTemplateLoaded,
    handleTemplateSelection,
  };
}
