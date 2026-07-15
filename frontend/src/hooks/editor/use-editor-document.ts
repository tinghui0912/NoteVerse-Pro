'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useAutoSave } from '@/hooks/editor/use-auto-save';
import { useEditorOriginalImages } from '@/hooks/editor/use-editor-original-images';
import { useEditorSaveErrorToast } from '@/hooks/editor/use-editor-save-error-toast';
import { useEditorSaveCompletion } from '@/hooks/editor/use-editor-save-completion';
import { useEditorValidationGate } from '@/hooks/editor/use-editor-validation-gate';
import { useEditorXmlActions } from '@/hooks/editor/use-editor-xml-actions';
import { ensureStableMusicXmlIdsString, stripAppOwnedMusicXmlIdsString } from '@/lib/musicxml/stable-ids';
import {
  useCreateRevision,
  useGenerateScoreFingering,
  useRevisionContent,
  useScoreDetail,
} from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { scoresApi } from '@/lib/api';
import { deleteDraft, loadDraft, type DraftEntry } from '@/lib/editor/draft-storage';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { queryKeys } from '@/lib/query-client';
import type { FingeringHandSize } from '@/types/api';
import type { EditorWorkspaceDocument } from '@/types/editor-workspace';

export function useEditorDocument({ scoreId, returnUrl }: { scoreId: string; returnUrl?: string }): EditorWorkspaceDocument {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { applyXml, clearXml, currentXml, normalizeVoices } = useEditorXmlActions();
  const completeSave = useEditorSaveCompletion({ applyXml });
  const showSaveError = useEditorSaveErrorToast();
  const scoreQuery = useScoreDetail(scoreId);
  const score = scoreQuery.data?.data;
  const [baseRevisionId, setBaseRevisionId] = useState('');
  const revisionId = baseRevisionId || score?.head_revision_id || '';
  const revisionQuery = useRevisionContent(scoreId, revisionId);
  const createRevision = useCreateRevision();
  const generateFingeringMutation = useGenerateScoreFingering();
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const { clearDraft, isSaving: isAutoSaving } = useAutoSave(scoreId, currentXml, {
    baseRevisionId: revisionId,
    debounceMs: 3000,
    enabled: Boolean(currentXml && revisionId),
  });
  const xmlContent = revisionQuery.data?.data?.content;
  const originalArtifacts = useMemo(
    () => (score?.input_assets ?? []).map((asset) => ({
      artifact_id: asset.asset_id,
    })),
    [score?.input_assets]
  );
  const downloadOriginalAsset = useCallback(
    (assetId: string) => scoresApi.downloadInputAsset(scoreId, assetId),
    [scoreId]
  );
  const originalImages = useEditorOriginalImages({
    artifacts: originalArtifacts,
    downloadArtifact: downloadOriginalAsset,
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
        const draft = await loadDraft(scoreId, revisionId);
        if (cancelled) return;
        const serverWorkingXml = ensureStableMusicXmlIdsString(xmlContent);
        if (draft && stripAppOwnedMusicXmlIdsString(draft.xml) !== stripAppOwnedMusicXmlIdsString(serverWorkingXml)) {
          setPendingDraft(draft);
          setDraftDialogOpen(true);
        } else if (draft) {
          await deleteDraft(scoreId, revisionId);
        }
        if (cancelled) return;
        await applyXml(xmlContent, { resetHistory: true, updateRawXml: true });
      } catch (error) {
        console.error('Failed to parse score XML:', error);
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
  }, [applyXml, clearXml, common, initialized, revisionId, scoreId, xmlContent]);

  const performSave = () => {
    if (!currentXml || !revisionId) return;
    const sanitizedContent = stripAppOwnedMusicXmlIdsString(currentXml);
    createRevision.mutate(
      {
        scoreId,
        content: sanitizedContent,
        base_revision_id: revisionId,
        idempotency_key: crypto.randomUUID(),
      },
      {
        onSuccess: async (response) => {
          const nextRevision = response.data?.revision_id;
          if (nextRevision === revisionId) {
            await clearDraft();
            toast({ title: t('noChangesTitle'), description: t('noChangesDesc') });
            return;
          }
          await completeSave({
            returnUrl: returnUrl || `/score/${scoreId}`,
            beforeNavigate: async () => {
              await clearDraft();
              if (nextRevision) setBaseRevisionId(nextRevision);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(scoreId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.scores.revisionAssets(scoreId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.scores.revisions(scoreId) }),
              ]);
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
    if (revisionId) await deleteDraft(scoreId, revisionId);
    setPendingDraft(null);
    toast({ title: t('draftDiscarded'), description: t('draftDiscardedDesc') });
  };
  const generateFingering = (handSize: FingeringHandSize) => {
    if (!currentXml) return;

    generateFingeringMutation.mutate(
      {
        scoreId,
        content: currentXml,
        hand_size: handSize,
      },
      {
        onSuccess: async (response) => {
          const generatedXml = response.data?.content;
          if (!response.success || !generatedXml) {
            toast({
              title: t('fingeringFailed'),
              description: t('fingeringFailedDesc'),
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
            description: userFacingErrorMessage(errors, error, t('fingeringFailedDesc')),
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
    finalLoadError: scoreQuery.error || revisionQuery.error
      ? userFacingErrorMessage(
        errors,
        scoreQuery.error ?? revisionQuery.error,
        common('loadFailedDescription')
      )
      : loadError,
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
