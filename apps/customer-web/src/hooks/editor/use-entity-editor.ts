'use client';
import { useTranslations } from 'next-intl';
import { useEditorSession } from '@/contexts/editor-session-context';
import { useEditorState } from '@/contexts/editor-state-context';
import { deleteVoiceEvent, type DomainAnchor, type InsertionAnchor } from '@/lib/editor-domain';
import type { DomainSelectionCompanion } from '@/lib/editor/domain-selection-companion';
import {
  createDefaultAddModeInsertCommand,
  type AddModeInsertCommand,
} from './entity-editor/add-mode-command';
import { applyAddModeDomainInsert } from './entity-editor/add-mode-domain-insert';
export function useEntityEditor() {
  const session = useEditorSession();
  const ui = useEditorState();
  const t = useTranslations('editor.actions');
  const handleCloseModal = () => {
    ui.clearEditingSelection();
    ui.setInspectorOpen(false);
  };
  return {
    handleCloseModal,
    handleDomainSelectionCompanion: (companion: DomainSelectionCompanion) => {
      ui.openEditingSelection({ domainAnchor: companion.domainAnchor, domainCompanion: companion });
      ui.setInspectorOpen(true);
    },
    handleAddEntity: (
      insertionAnchor: InsertionAnchor,
      command: AddModeInsertCommand = createDefaultAddModeInsertCommand(),
    ) => {
      let id: DomainAnchor | null = null;
      const result = session.applyCommand((document) => {
        const result = applyAddModeDomainInsert({
          document,
          insertionAnchor,
          command,
          inputVoices: session.inputVoices,
        });
        if (result.success) {
          const event = result.document.events.find(
            (event) => !document.events.some((existing) => existing.id === event.id),
          );
          if (event) id = { kind: 'event', eventId: event.id };
        }
        return result;
      }, t('addNote'));
      if (result.success && id) {
        ui.openEditingSelection({ domainAnchor: id, domainCompanion: null });
        ui.setInspectorOpen(true);
      }
      return result;
    },
    handleDeleteEntity: (anchor: DomainAnchor | null) => {
      if (!anchor || (anchor.kind !== 'event' && anchor.kind !== 'noteAtom')) return;
      const result = session.applyCommand(
        (document) => deleteVoiceEvent({ document, eventId: anchor.eventId }),
        t('deleteNote'),
      );
      if (result.success) handleCloseModal();
      return result;
    },
  };
}
