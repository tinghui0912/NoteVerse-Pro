'use client';
import { useEditorSession } from '@/contexts/editor-session-context';
import { useEditorState } from '@/contexts/editor-state-context';
import type { ScoreDocument, DomainAnchor } from '@/lib/editor-domain';
export function useHistoryEditor() {
  const session = useEditorSession();
  const ui = useEditorState();
  const restore = (operation: () => ScoreDocument | null) => {
    const document = operation();
    if (!document) return;
    const domainAnchor = findExistingDomainAnchor(
      document,
      ui.editingSelection?.domainAnchor ?? null,
    );
    if (domainAnchor) ui.openEditingSelection({ domainAnchor, domainCompanion: null });
    else {
      ui.clearEditingSelection();
      ui.setInspectorOpen(false);
    }
  };
  return {
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    handleUndo: () => restore(session.undo),
    handleRedo: () => restore(session.redo),
  };
}
function findExistingDomainAnchor(
  document: ScoreDocument,
  anchor: DomainAnchor | null,
): DomainAnchor | null {
  if (!anchor) return null;
  if (anchor.kind === 'event') {
    return document.events.some((event) => event.id === anchor.eventId) ? anchor : null;
  }
  if (anchor.kind === 'noteAtom') {
    const event = document.events.find((candidate) => candidate.id === anchor.eventId);
    if (event?.kind !== 'pitched') return null;
    return event.notes.some((note) => note.id === anchor.noteAtomId) ? anchor : null;
  }
  return anchor;
}
