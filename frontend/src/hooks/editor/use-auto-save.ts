import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cleanOldDrafts,
  deleteDraft,
  loadDraft,
  saveDraft,
  type DraftEntry,
} from '@/lib/editor/draft-storage';

interface UseAutoSaveOptions {
  baseRevisionId: string;
  returnUrl?: string;
  debounceMs?: number;
  enabled?: boolean;
}

export function useAutoSave(
  scoreId: string,
  xml: string | null,
  options: UseAutoSaveOptions
): {
  clearDraft: () => Promise<void>;
  loadExistingDraft: () => Promise<DraftEntry | undefined>;
  isSaving: boolean;
} {
  const { baseRevisionId, returnUrl, debounceMs = 3000, enabled = true } = options;
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedXmlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !xml || !scoreId || !baseRevisionId || xml === lastSavedXmlRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await saveDraft(scoreId, baseRevisionId, xml, { returnUrl });
        lastSavedXmlRef.current = xml;
      } finally {
        setIsSaving(false);
      }
    }, debounceMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [baseRevisionId, debounceMs, enabled, returnUrl, scoreId, xml]);

  useEffect(() => {
    void cleanOldDrafts(7);
  }, []);

  const clearDraft = useCallback(async () => {
    await deleteDraft(scoreId, baseRevisionId);
    lastSavedXmlRef.current = null;
  }, [baseRevisionId, scoreId]);

  const loadExistingDraft = useCallback(
    () => loadDraft(scoreId, baseRevisionId),
    [baseRevisionId, scoreId]
  );

  return { clearDraft, loadExistingDraft, isSaving };
}
