import ScoreDetailPage from '@/features/scores/score-detail-page';
export default async function ScoreRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScoreDetailPage scoreId={id} />;
}
