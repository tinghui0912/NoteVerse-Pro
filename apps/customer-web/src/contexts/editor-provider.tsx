'use client';
import type { ReactNode } from 'react';
import { EditorSessionProvider } from './editor-session-context';
import { EditorStateProvider } from './editor-state-context';
export { useEditorSession } from './editor-session-context';
export { useEditorState, type EditorMode } from './editor-state-context';
// Re-export domain operation hooks
export { useEntityEditor } from '../hooks/editor/use-entity-editor';
export { useVoiceEditor } from '../hooks/editor/use-voice-editor';
export { useHistoryEditor } from '../hooks/editor/use-history-editor';
export { useMetadataEditor } from '../hooks/editor/use-metadata-editor';
export { useEditorDomainEdit } from '../hooks/editor/use-editor-domain-edit';
export { useEditorDomainRenderAnchors } from '../hooks/editor/use-editor-domain-render-anchors';
export { useEditingDomainInspectorViewModel } from '../hooks/editor/use-editing-domain-event';

export function EditorProvider({ children }: { children: ReactNode }) {
  return (
    <EditorSessionProvider>
      <EditorStateProvider>{children}</EditorStateProvider>
    </EditorSessionProvider>
  );
}
