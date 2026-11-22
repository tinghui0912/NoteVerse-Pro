'use client';

import { notFound, useParams } from 'next/navigation';
import { EditorWorkspacePage } from '@/components/editor/editor-workspace-page';
import { EditorProvider } from '@/contexts/editor-provider';
import { useReviewEditorDocument } from '@/features/imports/review/use-review-editor-document';

function ReviewEditorPageContent({ jobId }: { jobId: string }) {
  const document = useReviewEditorDocument({ jobId });
  return <EditorWorkspacePage document={document} />;
}

export default function ReviewEditorPage() {
  const params = useParams();
  const jobId = Array.isArray(params.jobId) ? params.jobId[0] : params.jobId;
  if (!jobId) notFound();
  return (
    <EditorProvider>
      <ReviewEditorPageContent jobId={jobId} />
    </EditorProvider>
  );
}
