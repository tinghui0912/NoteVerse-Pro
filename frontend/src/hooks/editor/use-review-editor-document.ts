'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAutoSave } from '@/hooks/editor/use-auto-save';
import { useEditorOriginalImages } from '@/hooks/editor/use-editor-original-images';
import { useEditorSaveErrorToast } from '@/hooks/editor/use-editor-save-error-toast';
import { useEditorSaveCompletion } from '@/hooks/editor/use-editor-save-completion';
import { useEditorValidationGate } from '@/hooks/editor/use-editor-validation-gate';
import { useEditorXmlActions } from '@/hooks/editor/use-editor-xml-actions';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { importJobsApi } from '@/lib/api';
import { ensureStableMusicXmlIdsString, stripAppOwnedMusicXmlIdsString } from '@/lib/musicxml/stable-ids';
import { deleteDraft, loadDraft, type DraftEntry } from '@/lib/editor/draft-storage';
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
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const { applyXml, clearXml, currentXml, normalizeVoices } = useEditorXmlActions();
  const completeSave = useEditorSaveCompletion({ applyXml });
  const showSaveError = useEditorSaveErrorToast({ titleNamespace: 'review' });
  const reviewQuery = useImportJobReview(jobId);
  const review = reviewQuery.data?.data;
  const updateReview = useUpdateImportJobReview();
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const xmlContent = review?.musicxml?.content;
  const draftResourceId = `review:${jobId}`;
  const draftBaseRevisionId = 'current';
  const { clearDraft, isSaving: isAutoSaving } = useAutoSave(draftResourceId, currentXml, {
    baseRevisionId: draftBaseRevisionId,
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
      router.replace(`/score/${review.score_id}`);
    }
  }, [review?.score_id, review?.state, router]);

  useEffect(() => {
    if (!xmlContent || initialized) return;
    let cancelled = false;
    void (async () => {
      try {
        const draft = await loadDraft(draftResourceId, draftBaseRevisionId);
        if (cancelled) return;
        const serverWorkingXml = ensureStableMusicXmlIdsString(xmlContent);
        if (draft && stripAppOwnedMusicXmlIdsString(draft.xml) !== stripAppOwnedMusicXmlIdsString(serverWorkingXml)) {
          setPendingDraft(draft);
          setDraftDialogOpen(true);
        } else if (draft) {
          await deleteDraft(draftResourceId, draftBaseRevisionId);
        }
        if (cancelled) return;
        await applyXml(xmlContent, { resetHistory: true, updateRawXml: true });
      } catch (error) {
        console.error('Failed to parse review XML:', error);
        if (!cancelled) {
          setLoadError(common('loadFailedDescription'));
          clearXml();
        }
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyXml, clearXml, common, draftBaseRevisionId, draftResourceId, initialized, xmlContent]);

  const performSave = () => {
    if (!currentXml) return;
    updateReview.mutate(
      { jobId, content: stripAppOwnedMusicXmlIdsString(currentXml) },
      {
        onSuccess: async (response) => {
          const updatedXml = response.data?.musicxml?.content ?? currentXml;
          await completeSave({
            xml: updatedXml,
            returnUrl: returnUrl || `/review/${jobId}`,
            beforeNavigate: clearDraft,
          });
        },
        onError: showSaveError,
      }
    );
  };

  const validationGate = useEditorValidationGate(performSave);
  const recoverDraft = async () => {
    if (pendingDraft) await applyXml(pendingDraft.xml, { resetHistory: true });
    setPendingDraft(null);
  };
  const discardDraft = async () => {
    await deleteDraft(draftResourceId, draftBaseRevisionId);
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
    normalizeVoices,
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
