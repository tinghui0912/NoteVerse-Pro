'use client';

import { useMemo } from 'react';
import { useEditorState } from '@/contexts/editor-state-context';
import {
  domainAnchorToEditorSelection,
  getInspectorViewModelForSelection,
  type InspectorViewModel,
  type DomainAnchor,
  type ScoreDocument,
  type TimelineGap,
  type VoiceEvent,
} from '@/lib/editor-domain';
import { useEditorDomainDocument } from './use-editor-domain-document';

export type EditingDomainEventState = {
  document: ScoreDocument | null;
  gaps: TimelineGap[];
  event: VoiceEvent | null;
  error: Error | null;
};

export type EditingDomainInspectorViewModelState = EditingDomainEventState & {
  viewModel: InspectorViewModel | null;
  viewModelSource: 'domainAnchor' | 'unavailable';
};

export function findDomainVoiceEventForAnchor(
  document: ScoreDocument | null,
  anchor: DomainAnchor | null,
): VoiceEvent | null {
  if (!document || !anchor) return null;
  if (anchor.kind !== 'event' && anchor.kind !== 'noteAtom') return null;
  return document.events.find((event) => event.id === anchor.eventId) ?? null;
}

export function useEditingDomainEvent(): EditingDomainEventState {
  const { editingSelection } = useEditorState();
  const domainDocument = useEditorDomainDocument();
  const domainAnchor = editingSelection?.domainAnchor ?? null;

  const event = useMemo(() => (
    findDomainVoiceEventForAnchor(domainDocument.document, domainAnchor)
  ), [domainAnchor, domainDocument.document]);

  return {
    document: domainDocument.document,
    gaps: domainDocument.gaps,
    event,
    error: domainDocument.error,
  };
}

export function useEditingDomainInspectorViewModel(): EditingDomainInspectorViewModelState {
  const { editingSelection } = useEditorState();
  const state = useEditingDomainEvent();
  const domainAnchor = editingSelection?.domainAnchor ?? null;
  const anchorViewModel = useMemo(() => {
    if (!state.document || !domainAnchor) return null;
    const selection = domainAnchorToEditorSelection(domainAnchor);
    const selectedViewModel = selection ? getInspectorViewModelForSelection(state.document, selection) : null;
    if (selectedViewModel?.kind === 'noteAtom' && state.event) {
      return getInspectorViewModelForSelection(state.document, {
        kind: 'event',
        eventId: state.event.id,
      });
    }
    return selectedViewModel;
  }, [domainAnchor, state.document, state.event]);
  const viewModel = anchorViewModel;
  const viewModelSource = viewModel ? 'domainAnchor' : 'unavailable';

  return {
    ...state,
    viewModel,
    viewModelSource,
  };
}
