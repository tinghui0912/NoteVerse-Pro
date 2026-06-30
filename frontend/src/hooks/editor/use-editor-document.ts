'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useHistory, useScoreData } from '@/contexts/editor-provider';
import { useAutoSave } from '@/hooks/editor/use-auto-save';
import { useJobDetail } from '@/hooks/queries/use-job-queries';
import {
  useCreateRevision,
  useGenerateScoreFingering,
  useRevisionContent,
  useScoreDetail,
} from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { jobsApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { deleteDraft, loadDraft, type DraftEntry } from '@/lib/editor/draft-storage';
import { normalizeMeasureVoices } from '@/lib/musicxml/flatten';
import { ensureStableMusicXmlIdsString } from '@/lib/musicxml/stable-ids';
import { validateDataIntegrity, type ValidationResult } from '@/lib/musicxml/validator';
import type { FingeringHandSize } from '@/types/api';

export function useEditorDocument({ id, returnUrl }: { id: string; returnUrl?: string }) {
  const router = useRouter();
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const { toast } = useToast();
  const { scoreData, setScoreData, setRawXml, currentXml, currentXmlRef, setCurrentXml } = useScoreData();
  const { initialize: initializeHistory, push: pushHistory } = useHistory();
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
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [originalImages, setOriginalImages] = useState<{ src: string; alt: string }[]>([]);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const { clearDraft, isSaving: isAutoSaving } = useAutoSave(id, currentXml, {
    baseRevisionId: revisionId,
    returnUrl,
    debounceMs: 3000,
    enabled: Boolean(currentXml && revisionId),
  });
  const xmlContent = revisionQuery.data?.data?.content;

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
        const normalizedXml = ensureStableMusicXmlIdsString(xmlContent);
        setRawXml(normalizedXml);
        setCurrentXml(normalizedXml);
        initializeHistory(normalizedXml);
        const { MusicXMLParser } = await import('@/lib/musicxml/parser');
        if (!cancelled) setScoreData(new MusicXMLParser(normalizedXml).parse());
      } catch (error) {
        console.error('Failed to parse score XML:', error);
        if (!cancelled) {
          setLoadError(t('loadFailedHint'));
          setScoreData(null);
          setRawXml(null);
        }
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, initializeHistory, initialized, revisionId, setCurrentXml, setRawXml, setScoreData, t, xmlContent]);

  useEffect(() => {
    const jobId = score?.originating_job_id;
    const artifacts = jobQuery.data?.data?.artifacts?.original_image ?? [];
    const controller = new AbortController();
    const owned = ownedObjectUrlsRef.current;
    let loaded: string[] = [];
    if (!jobId || !artifacts.length) {
      setOriginalImages([]);
      return;
    }
    void Promise.all(
      artifacts.map((artifact) => jobsApi.downloadJobArtifact(jobId, artifact.artifact_id))
    ).then((blobs) => {
      if (controller.signal.aborted) return;
      loaded = blobs.map(URL.createObjectURL);
      loaded.forEach((url) => owned.add(url));
      setOriginalImages(loaded.map((src, index) => ({
        src,
        alt: t('originalScorePage', { page: index + 1 }),
      })));
    });
    return () => {
      controller.abort();
      loaded.forEach((url) => {
        URL.revokeObjectURL(url);
        owned.delete(url);
      });
    };
  }, [jobQuery.data?.data?.artifacts?.original_image, score?.originating_job_id, t]);

  useEffect(() => {
    const urls = ownedObjectUrlsRef.current;
    return () => {
      urls.forEach(URL.revokeObjectURL);
      urls.clear();
    };
  }, []);

  const translateValidationKey = (key: string) => {
    if (!key.includes('.')) return t(key as never);
    const [namespace, ...rest] = key.split('.');
    const nestedKey = rest.join('.');
    if (namespace === 'editor') return t(nestedKey as never);
    if (namespace === 'common') return common(nestedKey as never);
    if (namespace === 'validation' || namespace === 'auth') return auth(`validation.${nestedKey}` as never);
    return key;
  };

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
          await clearDraft();
          if (nextRevision) setBaseRevisionId(nextRevision);
          toast({ title: common('savingSuccess'), description: common('scoreSaved') });
          router.push(returnUrl || `/results/${id}`);
        },
        onError: (error) => {
          const conflict = error instanceof ApiError && error.code === 'revision_conflict';
          toast({
            title: t('saveFailed'),
            description: conflict ? t('saveFailedDesc') : t('saveFailedDesc'),
            variant: 'destructive',
          });
        },
      }
    );
  };

  const save = () => {
    const result = validateDataIntegrity(scoreData, currentXml, translateValidationKey);
    if (!result.success || result.warnings.length > 0) {
      setValidationResult(result);
      setValidationDialogOpen(true);
      return;
    }
    performSave();
  };

  const saveIgnoringWarnings = () => {
    setValidationDialogOpen(false);
    setValidationResult(null);
    performSave();
  };
  const recoverDraft = async () => {
    if (pendingDraft) {
      const normalizedXml = ensureStableMusicXmlIdsString(pendingDraft.xml);
      setCurrentXml(normalizedXml);
      initializeHistory(normalizedXml);
      const { MusicXMLParser } = await import('@/lib/musicxml/parser');
      setScoreData(new MusicXMLParser(normalizedXml).parse());
      toast({ title: t('draftRecovered'), description: t('draftRecoveredDesc') });
    }
    setPendingDraft(null);
  };
  const discardDraft = async () => {
    if (revisionId) await deleteDraft(id, revisionId);
    setPendingDraft(null);
    toast({ title: t('draftDiscarded'), description: t('draftDiscardedDesc') });
  };
  const normalizeVoices = async () => {
    if (!currentXml) return;
    const flattenedXml = ensureStableMusicXmlIdsString(normalizeMeasureVoices(currentXml));
    setCurrentXml(flattenedXml);
    initializeHistory(flattenedXml);
    const { MusicXMLParser } = await import('@/lib/musicxml/parser');
    setScoreData(new MusicXMLParser(flattenedXml).parse());
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
            const normalizedXml = ensureStableMusicXmlIdsString(generatedXml);
            currentXmlRef.current = normalizedXml;
            setCurrentXml(normalizedXml);
            pushHistory(normalizedXml, t('actions.generateFingering'));
            const { MusicXMLParser } = await import('@/lib/musicxml/parser');
            setScoreData(new MusicXMLParser(normalizedXml).parse());
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
    currentXmlRef,
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
    save,
    saveIgnoringWarnings,
    savePending: createRevision.isPending,
    scoreData,
    setDraftDialogOpen,
    setValidationDialogOpen,
    validationDialogOpen,
    validationResult,
  };
}
