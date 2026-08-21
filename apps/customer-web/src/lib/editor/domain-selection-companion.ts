import {
  domainAnchorToEditorSelection,
  getInspectorViewModelForSelection,
  type DomainAnchor,
  type InspectorViewModel,
  type ScoreDocument,
} from '@/lib/editor-domain';

export type DomainSelectionCompanion = {
  domainAnchor: DomainAnchor;
  inspectorViewModel: InspectorViewModel;
};

export function createDomainSelectionCompanion(
  document: ScoreDocument | null,
  domainAnchor: DomainAnchor | null,
): DomainSelectionCompanion | null {
  if (!document || !domainAnchor) return null;

  const selection = domainAnchorToEditorSelection(domainAnchor);
  if (!selection) return null;

  const inspectorViewModel = getInspectorViewModelForSelection(document, selection);
  if (!inspectorViewModel) return null;

  return {
    domainAnchor,
    inspectorViewModel,
  };
}
