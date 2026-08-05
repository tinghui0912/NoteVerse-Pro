'use client';

import { Suspense } from 'react';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { EditorWorkspacePage } from '@/components/editor/editor-workspace-page';
import { EditorProvider } from '@/contexts/editor-provider';
import { useReviewEditorDocument } from '@/hooks/editor/use-review-editor-document';

function ReviewEditorPageContent({
  jobId,
  returnUrl,
}: {
  jobId: string;
  returnUrl?: string;
}) {
  const document = useReviewEditorDocument({ jobId, returnUrl });

  return <EditorWorkspacePage document={document} />;
}

export default function ReviewEditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const jobId = Array.isArray(params.jobId) ? params.jobId[0] : params.jobId;
  const returnUrl = searchParams.get('returnUrl') || undefined;

  if (!jobId) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <EditorProvider>
        <ReviewEditorPageContent jobId={jobId} returnUrl={returnUrl} />
      </EditorProvider>
    </Suspense>
  );
}
