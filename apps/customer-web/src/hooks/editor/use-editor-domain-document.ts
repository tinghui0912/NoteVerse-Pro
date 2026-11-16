'use client';
import { useEditorSession } from '@/contexts/editor-session-context';
export function useEditorDomainDocument() {
  const {document,gaps,error}=useEditorSession();
  return {document,gaps,error};
}
