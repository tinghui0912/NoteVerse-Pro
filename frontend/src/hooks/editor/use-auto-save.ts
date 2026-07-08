import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cleanOldDrafts,
  deleteDraft,
  saveDraft,
} from '@/lib/editor/draft-storage';

interface UseAutoSaveOptions {
  baseRevisionId: string;
  debounceMs?: number;
  enabled?: boolean;
}

export function useAutoSave(
  scoreId: string,
  xml: string | null,
  options: UseAutoSaveOptions
): {
  clearDraft: () => Promise<void>;
  isSaving: boolean;
} {
  const { baseRevisionId, debounceMs = 3000, enabled = true } = options;
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedXmlRef = useRef<string | null>(null);
  const pendingXmlRef = useRef<string | null>(null);
  const baselineKeyRef = useRef<string | null>(null);

  const flushPendingDraft = useCallback(() => {
    const pendingXml = pendingXmlRef.current;
    if (!pendingXml || !scoreId || !baseRevisionId || pendingXml === lastSavedXmlRef.current) return;
    pendingXmlRef.current = null;
    void saveDraft(scoreId, baseRevisionId, pendingXml).then(() => {
      lastSavedXmlRef.current = pendingXml;
    });
  }, [baseRevisionId, scoreId]);

  useEffect(() => {
    if (!enabled || !xml || !scoreId || !baseRevisionId || xml === lastSavedXmlRef.current) return;
    const baselineKey = `${scoreId}:${baseRevisionId}`;
    if (baselineKeyRef.current !== baselineKey) {
      baselineKeyRef.current = baselineKey;
      lastSavedXmlRef.current = xml;
      pendingXmlRef.current = null;
      return;
    }
    pendingXmlRef.current = xml;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await saveDraft(scoreId, baseRevisionId, xml);
        lastSavedXmlRef.current = xml;
        if (pendingXmlRef.current === xml) pendingXmlRef.current = null;
      } finally {
        setIsSaving(false);
      }
    }, debounceMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [baseRevisionId, debounceMs, enabled, flushPendingDraft, scoreId, xml]);

  useEffect(() => {
    const handlePageHide = () => flushPendingDraft();
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      flushPendingDraft();
    };
  }, [flushPendingDraft]);

  useEffect(() => {
    void cleanOldDrafts(7);
  }, []);

  const clearDraft = useCallback(async () => {
    await deleteDraft(scoreId, baseRevisionId);
    lastSavedXmlRef.current = null;
  }, [baseRevisionId, scoreId]);

  return { clearDraft, isSaving };
}
