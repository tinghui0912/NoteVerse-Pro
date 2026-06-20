'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useHistory, useScoreData } from '@/contexts/editor-provider';
import { useShare } from '@/contexts/share-context';
import { useAutoSave } from '@/hooks/use-auto-save';
import { useToast } from '@/hooks/use-toast';
import { useTaskDetail } from '@/hooks/queries/use-task-queries';
import { useSaveXml, useXmlContent } from '@/hooks/queries/use-xml-queries';
import { deleteDraft, loadDraft, type DraftEntry } from '@/lib/draft-storage';
import { flattenAllMeasures } from '@/lib/musicxml/flatten';
import { validateDataIntegrity, type ValidationResult } from '@/lib/musicxml/validator';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { getEditorSaveTarget, type EditorSource } from '@/lib/editor/route';

export function useEditorDocument({ id, source, returnUrl }: { id: string; source: EditorSource; returnUrl?: string }) {
  const router = useRouter();
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const { toast } = useToast();
  const { shareToken } = useShare();
  const { scoreData, setScoreData, setRawXml, currentXml, currentXmlRef, setCurrentXml } = useScoreData();
  const { initialize: initializeHistory } = useHistory();
  const xmlQuery = useXmlContent(id, source, { shareToken });
  const taskQuery = useTaskDetail(id, { shareToken });
  const saveXml = useSaveXml();
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [originalImages, setOriginalImages] = useState<{ src: string; alt: string }[]>([]);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const { clearDraft, isSaving: isAutoSaving } = useAutoSave(id, currentXml, {
    source,
    returnUrl,
    debounceMs: 3000,
    enabled: Boolean(currentXml),
  });

  useEffect(() => {
    if (!xmlQuery.data || initialized) return;
    let cancelled = false;
    void (async () => {
      try {
        const draft = await loadDraft(id);
        if (cancelled) return;
        if (draft && draft.xml !== xmlQuery.data) {
          setPendingDraft(draft);
          setDraftDialogOpen(true);
        } else if (draft) {
          await deleteDraft(id);
        }
        if (cancelled) return;
        setRawXml(xmlQuery.data);
        setCurrentXml(xmlQuery.data);
        initializeHistory(xmlQuery.data);
        const { MusicXMLParser } = await import('@/lib/musicxml/parser');
        if (cancelled) return;
        setScoreData(new MusicXMLParser(xmlQuery.data).parse());
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
  }, [id, initializeHistory, initialized, setCurrentXml, setRawXml, setScoreData, t, xmlQuery.data]);

  useEffect(() => {
    if (!xmlQuery.error) return;
    setLoadError(t('loadFailedHint'));
    setScoreData(null);
    setRawXml(null);
    setInitialized(true);
  }, [setRawXml, setScoreData, t, xmlQuery.error]);

  const originalImageCount = taskQuery.data?.data?.files?.original_image?.length ?? 0;
  useEffect(() => {
    const controller = new AbortController();
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    let loaded: { src: string; alt: string }[] = [];
    void Promise.all(
      Array.from({ length: originalImageCount }, (_, index) =>
        fetchAuthenticatedImage(id, 'original_image', index + 1, shareToken, undefined, controller.signal)
      )
    ).then((urls) => {
      if (controller.signal.aborted) return;
      loaded = urls.flatMap((url, index) => url ? [{ src: url, alt: t('originalScorePage', { page: index + 1 }) }] : []);
      loaded.forEach(({ src }) => {
        if (src.startsWith('blob:')) ownedObjectUrls.add(src);
      });
      setOriginalImages(loaded);
    });
    return () => {
      controller.abort();
      loaded.forEach(({ src }) => {
        if (src.startsWith('blob:')) {
          URL.revokeObjectURL(src);
          ownedObjectUrls.delete(src);
        }
      });
    };
  }, [id, originalImageCount, shareToken, t]);

  useEffect(() => {
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    return () => {
      ownedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedObjectUrls.clear();
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
    if (!currentXml) return;
    const target = getEditorSaveTarget(source, id, returnUrl);
    saveXml.mutate(
      {
        taskId: id,
        content: currentXml,
        fileType: target.fileType,
        imageType: target.imageType,
      },
      {
        onSuccess: async () => {
          await clearDraft();
          toast({ title: common('savingSuccess'), description: common('scoreSaved') });
          router.push(target.redirectTo);
        },
        onError: (error) => {
          console.error('Failed to save score:', error);
          toast({ title: t('saveFailed'), description: t('saveFailedDesc'), variant: 'destructive' });
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
      setCurrentXml(pendingDraft.xml);
      initializeHistory(pendingDraft.xml);
      const { MusicXMLParser } = await import('@/lib/musicxml/parser');
      setScoreData(new MusicXMLParser(pendingDraft.xml).parse());
      toast({ title: t('draftRecovered'), description: t('draftRecoveredDesc') });
    }
    setPendingDraft(null);
  };

  const discardDraft = async () => {
    await deleteDraft(id);
    setPendingDraft(null);
    toast({ title: t('draftDiscarded'), description: t('draftDiscardedDesc') });
  };

  const mergeParts = async () => {
    if (!currentXml) return;
    try {
      const flattenedXml = flattenAllMeasures(currentXml);
      setCurrentXml(flattenedXml);
      initializeHistory(flattenedXml);
      const { MusicXMLParser } = await import('@/lib/musicxml/parser');
      setScoreData(new MusicXMLParser(flattenedXml).parse());
    } catch (error) {
      console.error('Failed to merge parts:', error);
    }
  };

  return {
    currentXml,
    currentXmlRef,
    discardDraft,
    draftDialogOpen,
    finalLoadError: xmlQuery.error ? t('loadFailedHint') : loadError,
    isAutoSaving,
    isLoading: xmlQuery.isLoading || taskQuery.isLoading || (Boolean(xmlQuery.data) && !initialized),
    mergeParts,
    originalImages,
    pendingDraft,
    recoverDraft,
    save,
    saveIgnoringWarnings,
    savePending: saveXml.isPending,
    scoreData,
    setDraftDialogOpen,
    setValidationDialogOpen,
    validationDialogOpen,
    validationResult,
  };
}
