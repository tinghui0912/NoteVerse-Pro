'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAutoSave } from '@/hooks/editor/use-auto-save';
import { useEditorOriginalImages } from '@/hooks/editor/use-editor-original-images';
import { useEditorSaveErrorToast } from '@/hooks/editor/use-editor-save-error-toast';
import { useEditorSaveCompletion } from '@/hooks/editor/use-editor-save-completion';
import { useEditorValidationGate } from '@/hooks/editor/use-editor-validation-gate';
import {useEditorSession} from '@/contexts/editor-session-context';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { importJobsApi } from '@/features/imports/api/jobs';
import { ensureGenericRenderMusicXmlIdsString, stripAppOwnedGenericRenderMusicXmlIdsString } from '@/lib/musicxml/generic-render-ids';
import { deleteDraft, loadDraft, type DraftEntry } from '@/lib/editor/draft-storage';
import { reportUnexpectedClientError } from '@/lib/observability';
import { useImportJobReview, useUpdateImportJobReview } from '@/features/imports/queries';
import { scoreLocation } from '@/features/scores/routes';
import { importReviewLocation } from '@/features/imports/routes';
import type { EditorWorkspaceDocument } from '@/types/editor-workspace';

export function useReviewEditorDocument({
  jobId,
}: {
  jobId: string;
}): EditorWorkspaceDocument {
  const router = useRouter();
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const {loadMusicXml,clearDocument,serializedXml:currentXml}=useEditorSession();
  const completeSave = useEditorSaveCompletion();
  const showSaveError = useEditorSaveErrorToast({ titleNamespace: 'review' });
  const reviewQuery = useImportJobReview(jobId);
  const review = reviewQuery.data;
  const updateReview = useUpdateImportJobReview();
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const xmlContent = review?.musicxml?.content;
  const draftResourceId = `review:${jobId}`;
  const draftBaselineRevisionId = 'current';
  const { clearDraft, isSaving: isAutoSaving } = useAutoSave(draftResourceId, currentXml, {
    baselineRevisionId: draftBaselineRevisionId,
    debounceMs: 3000,
    enabled: Boolean(currentXml && initialized),
  });
  const originalArtifacts = useMemo(
    () => review?.original_images ?? [],
    [review?.original_images]
  );
  const downloadOriginalArtifact = useCallback(
    (artifactId: string) => importJobsApi.downloadImportJobArtifact(jobId, artifactId),
    [jobId]
  );
  const originalImages = useEditorOriginalImages({
    artifacts: originalArtifacts,
    downloadArtifact: downloadOriginalArtifact,
    namespace: 'review',
  });

  useEffect(() => {
    if (review?.state === 'CONFIRMED' && review.score_id) {
      router.replace(scoreLocation(review.score_id));
    }
  }, [review?.score_id, review?.state, router]);

  useEffect(() => {
    if (!xmlContent || initialized) return;
    let cancelled = false;
    void (async () => {
      try {
        const draft = await loadDraft(draftResourceId, draftBaselineRevisionId);
        if (cancelled) return;
        const serverWorkingXml = ensureGenericRenderMusicXmlIdsString(xmlContent);
        if (draft && stripAppOwnedGenericRenderMusicXmlIdsString(draft.xml) !== stripAppOwnedGenericRenderMusicXmlIdsString(serverWorkingXml)) {
          setPendingDraft(draft);
          setDraftDialogOpen(true);
        } else if (draft) {
          await deleteDraft(draftResourceId, draftBaselineRevisionId);
        }
        if (cancelled) return;
        loadMusicXml(xmlContent);
      } catch (error) {
        if (!cancelled) {
          reportUnexpectedClientError(error, {
            area: 'editor',
            action: 'load_review_document',
            job_id: jobId,
          });
          setLoadError(common('loadFailedDescription'));
          clearDocument();
        }
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMusicXml, clearDocument, common, draftBaselineRevisionId, draftResourceId, initialized, jobId, xmlContent]);

  const performSave = () => {
    if (!currentXml) return;
    updateReview.mutate(
      { jobId, content: stripAppOwnedGenericRenderMusicXmlIdsString(currentXml) },
      {
        onSuccess: async () => {
          await completeSave({

            returnUrl: importReviewLocation(jobId),
            beforeNavigate: clearDraft,
          });
        },
        onError: showSaveError,
      }
    );
  };

  const validationGate = useEditorValidationGate(performSave);
  const recoverDraft = async () => {
    if (pendingDraft) loadMusicXml(pendingDraft.xml);
    setPendingDraft(null);
  };
  const discardDraft = async () => {
    await deleteDraft(draftResourceId, draftBaselineRevisionId);
    setPendingDraft(null);
  };

  return {
    currentXml,
    discardDraft,
    draftDialogOpen,
    finalLoadError: reviewQuery.error
      ? userFacingErrorMessage(errors, reviewQuery.error, common('loadFailedDescription'))
      : loadError,
    isAutoSaving,
    isLoading: reviewQuery.isLoading || (Boolean(xmlContent) && !initialized),
    originalImages,
    pendingDraft,
    recoverDraft,
    save: validationGate.save,
    saveIgnoringWarnings: validationGate.saveIgnoringWarnings,
    savePending: updateReview.isPending,
    setDraftDialogOpen,
    setValidationDialogOpen: validationGate.setValidationDialogOpen,
    validationDialogOpen: validationGate.validationDialogOpen,
    validationResult: validationGate.validationResult,
  };
}
