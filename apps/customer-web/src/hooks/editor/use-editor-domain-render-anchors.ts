'use client';

import { useCallback, useMemo } from 'react';
import {
  createSourceRenderAnchorsFromDocument,
  resolveDomainAnchorFromRenderOrSourceId,
  type DomainAnchor,
  type RenderAnchor,
  type ScoreDocument,
  type TimelineGap,
} from '@/lib/editor-domain';
import { useEditorDomainDocument } from './use-editor-domain-document';

export type EditorDomainRenderAnchorsState = {
  document: ScoreDocument | null;
  gaps: TimelineGap[];
  anchors: RenderAnchor[];
  error: Error | null;
  resolveAnchor: (renderOrSourceId: string | null | undefined) => DomainAnchor | null;
};

export function useEditorDomainRenderAnchors(): EditorDomainRenderAnchorsState {
  const { document, gaps, error } = useEditorDomainDocument();
  const anchors = useMemo(() => (
    document ? createSourceRenderAnchorsFromDocument(document) : []
  ), [document]);

  const resolveAnchor = useCallback((renderOrSourceId: string | null | undefined) => (
    resolveDomainAnchorFromRenderOrSourceId(anchors, renderOrSourceId)
  ), [anchors]);

  return {
    document,
    gaps,
    anchors,
    error,
    resolveAnchor,
  };
}
