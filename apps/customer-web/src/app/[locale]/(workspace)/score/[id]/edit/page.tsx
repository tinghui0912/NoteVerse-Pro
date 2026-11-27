'use client';
import { notFound, useParams } from 'next/navigation';
import { EditorWorkspacePage } from '@/components/editor/editor-workspace-page';
import { EditorProvider } from '@/contexts/editor-provider';
import { useScoreEditorDocument } from '@/features/scores/core/editor/use-score-editor-document';
function ScoreEditorContent({ scoreId }: { scoreId: string }) {
  const document = useScoreEditorDocument({ scoreId });
  return <EditorWorkspacePage document={document} />;
}
export default function ScoreEditorPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id) notFound();
  return <EditorProvider><ScoreEditorContent scoreId={id} /></EditorProvider>;
}
