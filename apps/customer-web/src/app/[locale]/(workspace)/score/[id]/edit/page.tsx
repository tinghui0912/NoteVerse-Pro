'use client';

import { Suspense } from 'react';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { EditorWorkspacePage } from '@/components/editor/editor-workspace-page';
import { EditorProvider } from '@/contexts/editor-provider';
import { useEditorDocument } from '@/hooks/editor/use-editor-document';

function EditorPageContent({ scoreId, returnUrl }: { scoreId: string; returnUrl?: string }) {
  const document = useEditorDocument({ scoreId, returnUrl });

  return (
    <EditorWorkspacePage
      document={document}
      scoreShell={{ scoreId, capabilities: document.scoreCapabilities }}
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
      <EditorProvider><EditorPageContent scoreId={id} returnUrl={returnUrl} /></EditorProvider>
    </Suspense>
  );
}
