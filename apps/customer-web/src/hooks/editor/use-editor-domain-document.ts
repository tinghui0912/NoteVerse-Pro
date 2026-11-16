'use client';

import { useMemo } from 'react';
import { importEditorMusicXml, type EditorMusicXmlImport } from '@/lib/editor-musicxml';
import { useScoreData } from '@/contexts/score-data-context';
import {
  type ScoreDocument,
  type TimelineGap,
} from '@/lib/editor-domain';

export type EditorDomainDocumentState = {
  document: ScoreDocument | null;
  gaps: TimelineGap[];
  error: Error | null;
};

export function deriveEditorDomainDocument(xml: string | null): EditorDomainDocumentState {
  if (!xml) {
    return {
      document: null,
      gaps: [],
      error: null,
    };
  }

  try {
    return toEditorDomainDocumentState(importEditorMusicXml(xml));
  } catch (error) {
    return {
      document: null,
      gaps: [],
      error: toError(error),
    };
  }
}

export function useEditorDomainDocument(): EditorDomainDocumentState {
  const { currentXml } = useScoreData();
  return useMemo(() => deriveEditorDomainDocument(currentXml), [currentXml]);
}

function toEditorDomainDocumentState(result: EditorMusicXmlImport): EditorDomainDocumentState {
  return {
    document: result.document,
    gaps: result.gaps,
    error: null,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
