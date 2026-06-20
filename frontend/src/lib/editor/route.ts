export type EditorSource = 'current' | 'final';

export function parseEditorSource(value: string | null): EditorSource | null {
  return value === 'final' || value === 'current' ? value : null;
}

export function getEditorSaveTarget(source: EditorSource, taskId: string, returnUrl?: string) {
  const current = source === 'current';
  return {
    fileType: current ? 'current_xml' as const : 'final_xml' as const,
    imageType: current ? 'preview_image' as const : 'final_image' as const,
    redirectTo: returnUrl || (current ? `/review/${taskId}` : `/results/${taskId}`),
  };
}
