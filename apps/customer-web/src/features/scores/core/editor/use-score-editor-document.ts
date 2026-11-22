'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAutoSave } from '@/hooks/editor/use-auto-save';
import { useEditorOriginalImages } from '@/hooks/editor/use-editor-original-images';
import { useEditorSaveErrorToast } from '@/hooks/editor/use-editor-save-error-toast';
import { useEditorSaveCompletion } from '@/hooks/editor/use-editor-save-completion';
import { useEditorValidationGate } from '@/hooks/editor/use-editor-validation-gate';
import {useEditorSession} from '@/contexts/editor-session-context';
import { ensureGenericRenderMusicXmlIdsString, stripAppOwnedGenericRenderMusicXmlIdsString } from '@/lib/musicxml/generic-render-ids';
import { useCreateRevision, useGenerateScoreFingering, useRevisionContent, useScoreDetail } from '@/features/scores/core/queries';
import { useToast } from '@/hooks/use-toast';
import { scoresApi } from '@/features/scores/core/api';
import { deleteDraft, loadDraft, type DraftEntry } from '@/lib/editor/draft-storage';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';
import type { FingeringRequest } from '@/generated/api';
import { scoreLocation } from '@/features/scores/routes';
import type { EditorWorkspaceDocument } from '@/types/editor-workspace';

export function useScoreEditorDocument({ scoreId }: { scoreId: string }): EditorWorkspaceDocument {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const { toast } = useToast();
  const {loadMusicXml,clearDocument,serializedXml:currentXml,replaceFromExternalMusicXml}=useEditorSession();
  const completeSave = useEditorSaveCompletion();
  const showSaveError = useEditorSaveErrorToast();
  const scoreQuery = useScoreDetail(scoreId);
  const score = scoreQuery.data;
  const [baselineRevisionId, setBaselineRevisionId] = useState('');
  const revisionId = baselineRevisionId || score?.head_revision_id || '';
  const revisionQuery = useRevisionContent(scoreId, revisionId);
  const createRevision = useCreateRevision();
  const generateFingeringMutation = useGenerateScoreFingering();
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const { clearDraft, isSaving: isAutoSaving } = useAutoSave(scoreId, currentXml, {
    baselineRevisionId: revisionId,
    debounceMs: 3000,
    enabled: Boolean(currentXml && revisionId),
  });
  const xmlContent = revisionQuery.data?.content;
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
    if (!xmlContent || !revisionId || initialized) return;
    let cancelled = false;
    void (async () => {
      try {
        const draft = await loadDraft(scoreId, revisionId);
        if (cancelled) return;
        setBaselineRevisionId(revisionId);
        const serverWorkingXml = ensureGenericRenderMusicXmlIdsString(xmlContent);
        if (draft && stripAppOwnedGenericRenderMusicXmlIdsString(draft.xml) !== stripAppOwnedGenericRenderMusicXmlIdsString(serverWorkingXml)) {
          setPendingDraft(draft);
          setDraftDialogOpen(true);
        } else if (draft) {
          await deleteDraft(scoreId, revisionId);
        }
        if (cancelled) return;
        loadMusicXml(xmlContent);
      } catch (error) {
        if (!cancelled) {
          reportUnexpectedClientError(error, {
            area: 'editor',
            action: 'load_score_document',
            score_id: scoreId,
            revision_id: revisionId,
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
  }, [loadMusicXml, clearDocument, common, initialized, revisionId, scoreId, xmlContent]);

  const performSave = () => {
    if (!currentXml || !revisionId) return;
    const sanitizedContent = stripAppOwnedGenericRenderMusicXmlIdsString(currentXml);
    createRevision.mutate(
      {
        scoreId,
        content: sanitizedContent,
        expected_head_revision_id: revisionId,
        idempotency_key: crypto.randomUUID(),
      },
      {
        onSuccess: async (response) => {
          const nextRevision = response?.revision_id;
          if (nextRevision === revisionId) {
            await clearDraft();
            toast({ title: t('noChangesTitle'), description: t('noChangesDesc') });
            return;
          }
          await completeSave({
            returnUrl: scoreLocation(scoreId),
            beforeNavigate: async () => {
              await clearDraft();
              if (nextRevision) setBaselineRevisionId(nextRevision);
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
      loadMusicXml(pendingDraft.xml);
      toast({ title: t('draftRecovered'), description: t('draftRecoveredDesc') });
    }
    setPendingDraft(null);
  };
  const discardDraft = async () => {
    if (revisionId) await deleteDraft(scoreId, revisionId);
    setPendingDraft(null);
    toast({ title: t('draftDiscarded'), description: t('draftDiscardedDesc') });
  };
  const generateFingering = (handSize: NonNullable<FingeringRequest['hand_size']>) => {
    if (!currentXml) return;

    generateFingeringMutation.mutate(
      {
        scoreId,
        content: currentXml,
        hand_size: handSize,
      },
      {
        onSuccess: async (response) => {
          const generatedXml = response?.content;
          if (!generatedXml) {
            toast({
              title: t('fingeringFailed'),
              description: t('fingeringFailedDesc'),
              variant: 'destructive',
            });
            return;
          }

          try {
            replaceFromExternalMusicXml(generatedXml,t('actions.generateFingering'));
            toast({ title: t('fingeringGenerated'), description: t('fingeringGeneratedDesc') });
          } catch (error) {
            reportUnexpectedClientError(error, {
              area: 'editor',
              action: 'apply_generated_fingering',
              score_id: scoreId,
            });
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
