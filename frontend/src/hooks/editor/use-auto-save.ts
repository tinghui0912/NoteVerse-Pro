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

  useEffect(() => {
    if (!enabled || !xml || !scoreId || !baseRevisionId || xml === lastSavedXmlRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await saveDraft(scoreId, baseRevisionId, xml);
        lastSavedXmlRef.current = xml;
      } finally {
        setIsSaving(false);
      }
    }, debounceMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [baseRevisionId, debounceMs, enabled, scoreId, xml]);

  useEffect(() => {
    void cleanOldDrafts(7);
  }, []);

  const clearDraft = useCallback(async () => {
    await deleteDraft(scoreId, baseRevisionId);
    lastSavedXmlRef.current = null;
  }, [baseRevisionId, scoreId]);

  return { clearDraft, isSaving };
}
