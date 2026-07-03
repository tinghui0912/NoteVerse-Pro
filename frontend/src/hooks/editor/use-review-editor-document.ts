'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEditorOriginalImages } from '@/hooks/editor/use-editor-original-images';
import { useEditorSaveErrorToast } from '@/hooks/editor/use-editor-save-error-toast';
import { useEditorSaveCompletion } from '@/hooks/editor/use-editor-save-completion';
import { useEditorValidationGate } from '@/hooks/editor/use-editor-validation-gate';
import { useEditorXmlActions } from '@/hooks/editor/use-editor-xml-actions';
import { useImportJobReview, useUpdateImportJobReview } from '@/hooks/queries/use-review-queries';
import type { EditorWorkspaceDocument } from '@/types/editor-workspace';

export function useReviewEditorDocument({
  jobId,
  returnUrl,
}: {
  jobId: string;
  returnUrl?: string;
}): EditorWorkspaceDocument {
  const router = useRouter();
  const reviewT = useTranslations('review');
  const { applyXml, clearXml, currentXml, normalizeVoices } = useEditorXmlActions();
  const completeSave = useEditorSaveCompletion({ applyXml });
  const showSaveError = useEditorSaveErrorToast({ titleNamespace: 'review' });
  const reviewQuery = useImportJobReview(jobId);
  const review = reviewQuery.data?.data;
  const updateReview = useUpdateImportJobReview();
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const xmlContent = review?.musicxml?.content;
  const originalArtifacts = useMemo(
    () => review?.original_images ?? [],
    [review?.original_images]
  );
  const originalImages = useEditorOriginalImages({
    jobId,
    artifacts: originalArtifacts,
    namespace: 'review',
  });

  useEffect(() => {
    if (review?.state === 'CONFIRMED' && review.score_id) {
      router.replace(`/score/${review.score_id}`);
    }
  }, [review?.score_id, review?.state, router]);

  useEffect(() => {
    if (!xmlContent || initialized) return;
    let cancelled = false;
    void (async () => {
      try {
        await applyXml(xmlContent, { resetHistory: true, updateRawXml: true });
      } catch (error) {
        console.error('Failed to parse review XML:', error);
        if (!cancelled) {
          setLoadError(reviewT('loadFailedHint'));
          clearXml();
        }
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyXml, clearXml, initialized, reviewT, xmlContent]);

  const performSave = () => {
    if (!currentXml) return;
    updateReview.mutate(
      { jobId, content: currentXml },
      {
        onSuccess: async (response) => {
          const updatedXml = response.data?.musicxml?.content ?? currentXml;
          await completeSave({
            xml: updatedXml,
            returnUrl: returnUrl || `/review/${jobId}`,
          });
        },
        onError: showSaveError,
      }
    );
  };

  const validationGate = useEditorValidationGate(performSave);

  return {
    currentXml,
    finalLoadError: reviewQuery.error ? reviewT('loadFailedHint') : loadError,
    isAutoSaving: false,
    isLoading: reviewQuery.isLoading || (Boolean(xmlContent) && !initialized),
    normalizeVoices,
    originalImages,
    save: validationGate.save,
    saveIgnoringWarnings: validationGate.saveIgnoringWarnings,
    savePending: updateReview.isPending,
    setValidationDialogOpen: validationGate.setValidationDialogOpen,
    validationDialogOpen: validationGate.validationDialogOpen,
    validationResult: validationGate.validationResult,
  };
}
