'use client';

import { useMemo, useState } from 'react';
import { createDeviceMockedCaptureExport, exportCaptureBundleJson } from '@/lib/practice/research/continuous-capture-harness';

export default function ResearchContinuousCaptureClient() {
  const [artifactPath, setArtifactPath] = useState('backend/data/work/continuous/score/practice-score-artifact.json');
  const [artifactSha, setArtifactSha] = useState(''.padStart(64, '0'));
  const [bpm, setBpm] = useState(90);
  const captureExport = useMemo(() => createDeviceMockedCaptureExport({
    practiceScoreArtifactPath: artifactPath,
    practiceScoreArtifactSha256: artifactSha,
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm },
    scope: { kind: 'FULL' },
  }), [artifactPath, artifactSha, bpm]);
  const bundleJson = useMemo(() => exportCaptureBundleJson(captureExport.bundle), [captureExport]);

  function download(name: string, data: BlobPart, type: string): void {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

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
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white" onClick={() => download('continuous-capture-bundle.json', bundleJson, 'application/json')}>
            Download bundle JSON
          </button>
          <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white" onClick={() => download('continuous-capture-midi-events.json', captureExport.midiEventLogJson, 'application/json')}>
            Download MIDI log
          </button>
          <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white" onClick={() => download('continuous-capture-audio.wav', captureExport.wavBytes.slice().buffer, 'audio/wav')}>
            Download WAV
          </button>
        </div>
        <h2 className="mb-2 text-base font-semibold">Device-Mocked Export Smoke</h2>
        <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs">{bundleJson}</pre>
      </section>
    </main>
  );
}
