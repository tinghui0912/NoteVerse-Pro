'use client';

import { useMemo, useState } from 'react';
import { createSyntheticContinuousCaptureBundle, exportCaptureBundleJson } from '@/lib/practice/research/continuous-capture-harness';

export default function ResearchContinuousCaptureClient() {
  const [artifactPath, setArtifactPath] = useState('backend/data/work/continuous/score/practice-score-artifact.json');
  const [artifactSha, setArtifactSha] = useState(''.padStart(64, '0'));
  const [bpm, setBpm] = useState(90);
  const bundleJson = useMemo(() => exportCaptureBundleJson(createSyntheticContinuousCaptureBundle({
    practiceScoreArtifactPath: artifactPath,
    practiceScoreArtifactSha256: artifactSha,
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm },
    scope: { kind: 'FULL' },
  })), [artifactPath, artifactSha, bpm]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Research only</p>
        <h1 className="text-2xl font-semibold text-slate-950">Continuous Paired Take Capture</h1>
      </header>
      <section className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          PracticeScoreArtifact path
          <input className="rounded border px-2 py-1" value={artifactPath} onChange={(event) => setArtifactPath(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          PracticeScoreArtifact SHA256
          <input className="rounded border px-2 py-1 font-mono" value={artifactSha} onChange={(event) => setArtifactSha(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fixed BPM
          <input className="rounded border px-2 py-1" type="number" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
        </label>
      </section>
      <section className="rounded border border-slate-200 bg-slate-50 p-4">
        <h2 className="mb-2 text-base font-semibold">Synthetic Export Smoke</h2>
        <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs">{bundleJson}</pre>
      </section>
    </main>
  );
}
