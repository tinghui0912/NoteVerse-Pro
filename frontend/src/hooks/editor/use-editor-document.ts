'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAutoSave } from '@/hooks/editor/use-auto-save';
import { useEditorOriginalImages } from '@/hooks/editor/use-editor-original-images';
import { useEditorSaveErrorToast } from '@/hooks/editor/use-editor-save-error-toast';
import { useEditorSaveCompletion } from '@/hooks/editor/use-editor-save-completion';
import { useEditorValidationGate } from '@/hooks/editor/use-editor-validation-gate';
import { useEditorXmlActions } from '@/hooks/editor/use-editor-xml-actions';
import { useJobDetail } from '@/hooks/queries/use-job-queries';
import {
  useCreateRevision,
  useGenerateScoreFingering,
  useRevisionContent,
  useScoreDetail,
} from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';
import { deleteDraft, loadDraft, type DraftEntry } from '@/lib/editor/draft-storage';
import type { FingeringHandSize } from '@/types/api';
import type { EditorWorkspaceDocument } from '@/types/editor-workspace';

export function useEditorDocument({ id, returnUrl }: { id: string; returnUrl?: string }): EditorWorkspaceDocument {
  const t = useTranslations('editor');
  const { toast } = useToast();
  const { applyXml, clearXml, currentXml, normalizeVoices } = useEditorXmlActions();
  const completeSave = useEditorSaveCompletion({ applyXml });
  const showSaveError = useEditorSaveErrorToast();
  const scoreQuery = useScoreDetail(id);
  const score = scoreQuery.data?.data;
  const [baseRevisionId, setBaseRevisionId] = useState('');
  const revisionId = baseRevisionId || score?.head_revision_id || '';
  const revisionQuery = useRevisionContent(id, revisionId);
  const jobQuery = useJobDetail(score?.originating_job_id ?? '', {
    enabled: Boolean(score?.originating_job_id),
  });
  const createRevision = useCreateRevision();
  const generateFingeringMutation = useGenerateScoreFingering();
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const { clearDraft, isSaving: isAutoSaving } = useAutoSave(id, currentXml, {
    baseRevisionId: revisionId,
    returnUrl,
    debounceMs: 3000,
    enabled: Boolean(currentXml && revisionId),
  });
  const xmlContent = revisionQuery.data?.data?.content;
  const originalArtifacts = useMemo(
    () => jobQuery.data?.data?.artifacts?.original_image ?? [],
    [jobQuery.data?.data?.artifacts?.original_image]
  );
  const originalImages = useEditorOriginalImages({
    jobId: score?.originating_job_id,
    artifacts: originalArtifacts,
    namespace: 'editor',
  });

  useEffect(() => {
    if (!score?.head_revision_id || baseRevisionId) return;
    setBaseRevisionId(score.head_revision_id);
  }, [baseRevisionId, score?.head_revision_id]);

  useEffect(() => {
    if (!xmlContent || !revisionId || initialized) return;
    let cancelled = false;
    void (async () => {
      try {
        const draft = await loadDraft(id, revisionId);
        if (cancelled) return;
        if (draft && draft.xml !== xmlContent) {
          setPendingDraft(draft);
          setDraftDialogOpen(true);
        } else if (draft) {
          await deleteDraft(id, revisionId);
        }
        if (cancelled) return;
        await applyXml(xmlContent, { resetHistory: true, updateRawXml: true });
      } catch (error) {
        console.error('Failed to parse score XML:', error);
        if (!cancelled) {
          setLoadError(t('loadFailedHint'));
          clearXml();
        }
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyXml, clearXml, id, initialized, revisionId, t, xmlContent]);

  const performSave = () => {
    if (!currentXml || !revisionId) return;
    createRevision.mutate(
      {
        scoreId: id,
        content: currentXml,
        base_revision_id: revisionId,
        idempotency_key: crypto.randomUUID(),
      },
      {
        onSuccess: async (response) => {
          const nextRevision = response.data?.revision_id;
          await completeSave({
            returnUrl: returnUrl || `/score/${id}`,
            beforeNavigate: async () => {
              await clearDraft();
              if (nextRevision) setBaseRevisionId(nextRevision);
            },
          });
        },
        onError: showSaveError,
      }
    );
  };

  const validationGate = useEditorValidationGate(performSave);
  const recoverDraft = async () => {
    if (pendingDraft) {
      await applyXml(pendingDraft.xml, { resetHistory: true });
      toast({ title: t('draftRecovered'), description: t('draftRecoveredDesc') });
    }
    setPendingDraft(null);
  };
  const discardDraft = async () => {
    if (revisionId) await deleteDraft(id, revisionId);
    setPendingDraft(null);
    toast({ title: t('draftDiscarded'), description: t('draftDiscardedDesc') });
  };
  const generateFingering = (handSize: FingeringHandSize) => {
    if (!currentXml) return;

    generateFingeringMutation.mutate(
      {
        scoreId: id,
        content: currentXml,
        hand_size: handSize,
      },
      {
        onSuccess: async (response) => {
          const generatedXml = response.data?.content;
          if (!response.success || !generatedXml) {
            toast({
              title: t('fingeringFailed'),
              description: response.message || t('fingeringFailedDesc'),
              variant: 'destructive',
            });
            return;
          }

          try {
            await applyXml(generatedXml, {
              historyLabel: t('actions.generateFingering'),
              resetHistory: false,
            });
            toast({ title: t('fingeringGenerated'), description: t('fingeringGeneratedDesc') });
          } catch (error) {
            console.error('Failed to apply generated fingering:', error);
            toast({
              title: t('fingeringFailed'),
              description: t('fingeringFailedDesc'),
              variant: 'destructive',
            });
          }
        },
        onError: (error) => {
          toast({
            title: t('fingeringFailed'),
            description: error instanceof ApiError ? error.message : t('fingeringFailedDesc'),
            variant: 'destructive',
          });
        },
      }
    );
  };

  return {
    currentXml,
    discardDraft,
    draftDialogOpen,
    finalLoadError: scoreQuery.error || revisionQuery.error ? t('loadFailedHint') : loadError,
    fingeringPending: generateFingeringMutation.isPending,
    generateFingering,
    isAutoSaving,
    isLoading: scoreQuery.isLoading || revisionQuery.isLoading || (Boolean(xmlContent) && !initialized),
    normalizeVoices,
    originalImages,
    pendingDraft,
    recoverDraft,
    save: validationGate.save,
    saveIgnoringWarnings: validationGate.saveIgnoringWarnings,
    savePending: createRevision.isPending,
    scoreCapabilities: score?.capabilities,
    setDraftDialogOpen,
    setValidationDialogOpen: validationGate.setValidationDialogOpen,
    validationDialogOpen: validationGate.validationDialogOpen,
    validationResult: validationGate.validationResult,
  };
}
