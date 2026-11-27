'use client';
import { useEditorSession } from '@/contexts/editor-session-context';
export function useEditorDomainDocument() {
  const { document, gaps } = useEditorSession();
  return { document, gaps };
}
