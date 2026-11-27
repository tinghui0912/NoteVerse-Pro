import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cleanOldDrafts,
  deleteDraft,
  saveDraft,
} from '@/lib/editor/draft-storage';

interface UseAutoSaveOptions {
  baselineRevisionId: string;
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
  const { baselineRevisionId, debounceMs = 3000, enabled = true } = options;
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedXmlRef = useRef<string | null>(null);
  const pendingXmlRef = useRef<string | null>(null);
  const baselineKeyRef = useRef<string | null>(null);

  const flushPendingDraft = useCallback(() => {
    const pendingXml = pendingXmlRef.current;
    if (!pendingXml || !scoreId || !baselineRevisionId || pendingXml === lastSavedXmlRef.current) return;
    pendingXmlRef.current = null;
    void saveDraft(scoreId, baselineRevisionId, pendingXml).then(() => {
      lastSavedXmlRef.current = pendingXml;
    });
  }, [baselineRevisionId, scoreId]);

  useEffect(() => {
    if (!enabled || !xml || !scoreId || !baselineRevisionId || xml === lastSavedXmlRef.current) return;
    const baselineKey = `${scoreId}:${baselineRevisionId}`;
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
        await saveDraft(scoreId, baselineRevisionId, xml);
        lastSavedXmlRef.current = xml;
        if (pendingXmlRef.current === xml) pendingXmlRef.current = null;
      } finally {
        setIsSaving(false);
      }
    }, debounceMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [baselineRevisionId, debounceMs, enabled, flushPendingDraft, scoreId, xml]);

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
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    pendingXmlRef.current = null;
    await deleteDraft(scoreId, baselineRevisionId);
    lastSavedXmlRef.current = xml;
  }, [baselineRevisionId, scoreId, xml]);

  return { clearDraft, isSaving };
}
