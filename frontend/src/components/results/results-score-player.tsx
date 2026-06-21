import { ScorePreviewPanel } from '@/components/score/score-preview-panel';

export function ResultsScorePlayer({ rawXml }: { rawXml: string }) {
  return (
    <ScorePreviewPanel
      xmlString={rawXml}
      className="gap-6"
      viewportClassName="min-h-[55vh] rounded-2xl border bg-white p-4 shadow-lg"
      controlsClassName="space-y-4 rounded-2xl border bg-white p-5 shadow-lg"
    />
  );
}
