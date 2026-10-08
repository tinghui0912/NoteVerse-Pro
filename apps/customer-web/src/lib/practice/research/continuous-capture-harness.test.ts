import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import canonicalArtifactJson from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import { createDeviceMockedCaptureExport, createSyntheticContinuousCaptureBundle, exportCaptureBundleJson } from './continuous-capture-harness';
import { importContinuousPairedTake, type ContinuousPairedTakeManifest } from './continuous-paired-take-corpus';

function write(root: string, relative: string, bytes: string | Uint8Array): string {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  return createHash('sha256').update(typeof bytes === 'string' ? Buffer.from(bytes) : bytes).digest('hex');
}

describe('Continuous research capture harness contract', () => {
  it('exports a syntactically valid synthetic bundle without counting as a real take', () => {
    const bundle = createSyntheticContinuousCaptureBundle({
      practiceScoreArtifactPath: 'score/practice-score-artifact.json',
      practiceScoreArtifactSha256: 'a'.repeat(64),
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
      scope: { kind: 'FULL' },
    });
    expect(bundle.status).toBe('SYNTHETIC_CAPTURE_SMOKE_ONLY');
    expect(bundle.productAccuracyMetric).toBe(false);
    expect(bundle.segments[0]).toMatchObject({
      sourcePerformanceStartSampleBoundary: 96_000,
      sourcePerformanceEndSampleBoundary: 144_000,
      sourceContextTailEndSampleBoundary: 240_000,
      performanceStartMs: 0,
      performanceEndMs: 1_000,
    });
    expect(JSON.parse(exportCaptureBundleJson(bundle)).artifact).toBe('continuous_research_capture_bundle');
  });

  it('exports device-mocked WAV/event-log bytes that re-import through the authoritative corpus importer', () => {
    const root = path.join(tmpdir(), `noteverse-capture-smoke-${crypto.randomUUID()}`);
    const artifact = {
      ...structuredClone(canonicalArtifactJson),
      scoreTempoSegments: [{ startBeat: 0, bpm: 60 }],
      scoreEndBeat: 1,
    };
    const scoreSha = write(root, 'score/practice-score-artifact.json', `${JSON.stringify(artifact, null, 2)}\n`);
    const policy = { schemaVersion: 2, artifact: 'continuous_paired_take_manifest_v2_policy', policyId: 'continuous-paired-take-v2', policyVersion: '2026-10-08' };
    const policySha = write(root, 'policy/continuous-paired-take-policy.json', `${JSON.stringify(policy, null, 2)}\n`);
    const capture = createDeviceMockedCaptureExport({
      practiceScoreArtifactPath: 'score/practice-score-artifact.json',
      practiceScoreArtifactSha256: scoreSha,
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 },
      scope: { kind: 'FULL' },
      performanceDurationMs: 1_000,
      midiEvents: [{
        eventId: 'midi-note-on-c4',
        type: 'NOTE_ON',
        midiNote: 60,
        pitch: 'C4',
        velocity: 90,
        captureClockMs: 2_000,
        performanceTimeMs: 0,
      }, {
        eventId: 'midi-pedal',
        type: 'CC',
        controller: 64,
        value: 127,
        captureClockMs: 2_010,
        performanceTimeMs: 10,
      }],
    });
    const wavSha = write(root, 'takes/mock.wav', capture.wavBytes);
    const midiSha = write(root, 'takes/mock.capture-events.json', capture.midiEventLogJson);
    const manifest: ContinuousPairedTakeManifest = {
      schemaVersion: 2,
      manifestId: 'device-mocked-capture-smoke',
      split: 'DEVELOPMENT',
      policy: { policyPath: 'policy/continuous-paired-take-policy.json', policyId: 'continuous-paired-take-v2', policyVersion: '2026-10-08', policySha256: policySha },
      takes: [{
        takeId: 'mock-take',
        captureSessionId: 'mock-session',
        score: { practiceScoreArtifactPath: 'score/practice-score-artifact.json', practiceScoreArtifactSha256: scoreSha, practiceScoreArtifactSchemaVersion: 1 },
        practice: capture.bundle.practice,
        audio: {
          path: 'takes/mock.wav',
          sha256: wavSha,
          container: 'RIFF_WAVE',
          encoding: 'PCM16',
          sampleRateHz: capture.bundle.audio.sampleRateHz,
          channelCount: capture.bundle.audio.channelCount,
          sampleFrameCount: capture.bundle.audio.sampleFrameCount,
          durationMs: 5_000,
          performanceOriginSourceMs: 2_000,
        },
        physicalMidi: { sourceKind: 'BROWSER_CAPTURE_EVENT_LOG', path: 'takes/mock.capture-events.json', sha256: midiSha, sameTakeAudioSha256: wavSha },
        segments: capture.bundle.segments,
        sync: { quality: 'SHARED_CAPTURE_CLOCK_VERIFIED', method: 'device mocked shared clock', sharedCaptureClockId: capture.bundle.captureClock.clockId },
        evidenceRole: 'SYNTHETIC_HARNESS',
      }],
    };
    const receipt = importContinuousPairedTake(manifest, 'mock-take', { repoRoot: root });
    expect(receipt.scenario.physicalGroundTruth?.attacks).toHaveLength(1);
    expect(receipt.scenario.source.provenance).toBe('SYNTHETIC_HARNESS');
  });
});
