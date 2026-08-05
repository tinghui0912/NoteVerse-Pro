'use client';

import { EditorPreviewPanel } from './editor-preview-panel';

interface EditorWorkbenchCenterProps {
  currentXml: string | null;
  onOpenScoreInspector: () => void;
}

export function EditorWorkbenchCenter({
  currentXml,
  onOpenScoreInspector,
}: EditorWorkbenchCenterProps) {
  return (
    <div className="min-w-0">
      <EditorPreviewPanel
        active
        currentXml={currentXml}
        onOpenScoreInspector={onOpenScoreInspector}
      />
    </div>
  );
}
