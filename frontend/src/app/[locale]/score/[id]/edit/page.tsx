'use client';

import { Suspense } from 'react';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { EditorWorkspacePage } from '@/components/editor/editor-workspace-page';
import { EditorProvider } from '@/contexts/editor-provider';
import { useEditorDocument } from '@/hooks/editor/use-editor-document';

function EditorPageContent({ id, returnUrl }: { id: string; returnUrl?: string }) {
  const document = useEditorDocument({ id, returnUrl });

  return (
    <EditorWorkspacePage
      document={document}
      scoreShell={{ scoreId: id, capabilities: document.scoreCapabilities }}
    />
  );
}

export default function EditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const returnUrl = searchParams.get('returnUrl') || undefined;

  if (!id) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <EditorProvider><EditorPageContent id={id} returnUrl={returnUrl} /></EditorProvider>
    </Suspense>
  );
}
