import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';

import canonicalArtifactJson from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import { ContinuousEvaluationSession } from '../local-core/continuous-evaluation-session';
import { buildContinuousExpectedStrikes } from '../local-core/continuous-expected-strikes';
import { ContinuousFinalizationLedger } from '../local-core/continuous-finalization-ledger';
import { PracticeTempoTimeline, resolvePracticeTempoPlan, type PracticeTempoSelection } from '../local-core/practice-tempo';
import type { PracticeScope, PracticeScoreArtifact } from '../local-core/artifact';
import { scoreCandidate } from './continuous-analyzer-bakeoff';
import {
  auditContinuousPairedTakeCorpus,
  canonicalManifestSha256,
  detectContinuousSplitLeakage,
  evaluationLockProjectionSha256,
  importContinuousPairedTake,
  importContinuousPairedTakeAsBenchmarkScenario,
  validateEvaluationLock,
  type ContinuousPairedTake,
  type ContinuousPairedTakeManifest,
} from './continuous-paired-take-corpus';
import { onlineAmtCandidateDefinition } from './online-amt-stateful-streaming';

const baseArtifact = canonicalArtifactJson as PracticeScoreArtifact;

function workspace(): string {
  return path.join(tmpdir(), `noteverse-continuous-corpus-${crypto.randomUUID()}`);
}

function writeJson(root: string, relative: string, value: unknown): string {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
  return sha256File(absolute);
}

function writeBytes(root: string, relative: string, bytes: Uint8Array): string {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  return sha256File(absolute);
}

function sha256File(absolute: string): string {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

function makeArtifact(): PracticeScoreArtifact {
  const artifact = structuredClone(baseArtifact) as PracticeScoreArtifact;
  artifact.scoreId = 'score-continuous-corpus-test';
  artifact.revisionId = 'rev-continuous-corpus-test';
  artifact.artifactId = 'artifact-continuous-corpus-test';
  artifact.scoreTempoSegments = [
    { startBeat: 0, bpm: 120 },
    { startBeat: 1, bpm: 60 },
  ];
  artifact.expectedPracticeGroups = [
    group('g1', 0, ['C4']),
    group('g2', 1, ['E4', 'G4']),
    group('g3', 2, ['C5']),
  ];
  artifact.practiceAttackSteps = artifact.expectedPracticeGroups.map((groupValue) => stepFromGroup(groupValue));
  artifact.scoreEndBeat = 3;
  return artifact;
}

function group(id: string, onsetBeat: number, pitches: string[]) {
  const template = structuredClone(baseArtifact.expectedPracticeGroups[0]);
  return {
    ...template,
    groupId: id,
    onsetBeat,
    canonicalEndBeat: onsetBeat + 0.25,
    pitches,
    renderNoteIds: pitches.map((pitch, index) => `${id}:note:${pitch}:${index}`),
    strikeTargets: pitches.map((pitch, index) => ({
      ...template.strikeTargets[Math.min(index, template.strikeTargets.length - 1)],
      strikeId: `${id}:strike:${pitch}:${index}`,
      pitch,
      renderNoteIds: [`${id}:note:${pitch}:${index}`],
      expectedNotes: [{
        eventId: `${id}:event`,
        expectedNoteId: `${id}:expected:${pitch}:${index}`,
        measureNumbers: ['1'],
        pitch,
        renderNoteId: `${id}:note:${pitch}:${index}`,
      }],
    })),
    expectedNotes: pitches.map((pitch, index) => ({
      eventId: `${id}:event`,
      expectedNoteId: `${id}:expected:${pitch}:${index}`,
      measureNumbers: ['1'],
      pitch,
      renderNoteId: `${id}:note:${pitch}:${index}`,
    })),
  };
}

function stepFromGroup(groupValue: PracticeScoreArtifact['expectedPracticeGroups'][number]) {
  const template = structuredClone(baseArtifact.practiceAttackSteps[0]);
  return {
    ...template,
    stepId: `${groupValue.groupId}:step`,
    onsetBeat: groupValue.onsetBeat,
    renderNoteIds: groupValue.renderNoteIds,
    attackTargets: groupValue.pitches.map((pitch, index) => ({
      ...template.attackTargets[Math.min(index, template.attackTargets.length - 1)],
      attackId: `${groupValue.groupId}:attack:${pitch}:${index}`,
      pitch,
      renderNoteIds: [`${groupValue.groupId}:note:${pitch}:${index}`],
      notes: [{
        eventId: `${groupValue.groupId}:event`,
        measureNumbers: ['1'],
        pitch,
        renderNoteId: `${groupValue.groupId}:note:${pitch}:${index}`,
        staffIds: ['1'],
        stepNoteId: `${groupValue.groupId}:step-note:${pitch}:${index}`,
        voiceIds: ['1'],
      }],
    })),
  };
}

function wavPcm16(sampleRateHz: number, sampleFrames: number, channels = 1): Uint8Array {
  const dataBytes = sampleFrames * channels * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRateHz, 24);
  bytes.writeUInt32LE(sampleRateHz * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

function midiBytes(notes: readonly { midi: number; time: number; velocity?: number }[]): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  for (const note of notes) track.addNote({ midi: note.midi, time: note.time, duration: 0.1, velocity: note.velocity ?? 0.7 });
  return new Uint8Array(midi.toArray());
}

function fixture(root = workspace(), overrides: Partial<ContinuousPairedTake> = {}) {
  const artifact = makeArtifact();
  const artifactSha = writeJson(root, 'score/practice-score-artifact.json', artifact);
  const audioSha = writeBytes(root, 'takes/take-dev-001.wav', wavPcm16(48_000, 240_000));
  const midiSha = writeBytes(root, 'takes/take-dev-001.mid', midiBytes([
    { midi: 60, time: 0 },
    { midi: 64, time: 0.5 },
    { midi: 67, time: 0.5 },
    { midi: 60, time: 0.75 },
  ]));
  const take: ContinuousPairedTake = {
    takeId: 'take-dev-001',
    captureSessionId: 'session-a',
    score: {
      practiceScoreArtifactPath: 'score/practice-score-artifact.json',
      practiceScoreArtifactSha256: artifactSha,
      practiceScoreArtifactSchemaVersion: 1,
    },
    practice: {
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 },
      scope: { kind: 'FULL' },
      completion: { kind: 'NATURAL', performanceTimeMs: 1_500 },
    },
    audio: {
      path: 'takes/take-dev-001.wav',
      sha256: audioSha,
      container: 'RIFF_WAVE',
      encoding: 'PCM16',
      sampleRateHz: 48_000,
      channelCount: 1,
      sampleFrameCount: 240_000,
      durationMs: 5_000,
      performanceOriginSourceMs: 2_000,
    },
    physicalMidi: {
      sourceKind: 'SYNCHRONIZED_PERFORMANCE_MIDI',
      path: 'takes/take-dev-001.mid',
      sha256: midiSha,
      sameTakeAudioSha256: audioSha,
    },
    segments: [{
      segmentId: 'seg-0',
      sourcePerformanceStartSampleBoundary: 96_000,
      sourcePerformanceEndSampleBoundary: 168_000,
      sourceContextTailEndSampleBoundary: 240_000,
      performanceStartMs: 0,
      performanceEndMs: 1_500,
    }],
    sync: { quality: 'SHARED_CAPTURE_CLOCK_VERIFIED', method: 'shared browser capture origin', sharedCaptureClockId: 'capture-clock-a' },
    familyTags: ['complete_chord', 'same_pitch_retrigger'],
    expectedGroupFamilyTags: { g2: ['complete_chord'] },
    ...overrides,
  };
  const manifest: ContinuousPairedTakeManifest = {
    schemaVersion: 2,
    manifestId: 'continuous-dev-v2',
    split: 'DEVELOPMENT',
    policy: { policyId: 'continuous-paired-take-v2', policyVersion: '2026-10-08', policySha256: '0'.repeat(64) },
    takes: [take],
  };
  return { root, artifact, take, manifest };
}

describe('Continuous paired take corpus contract v2', () => {
  it('does not accept manifest-provided authoritative ExpectedStrike truth', () => {
    const { root, manifest } = fixture();
    expect('expectedStrikes' in manifest.takes[0].score).toBe(false);
    expect(() => importContinuousPairedTake({
      ...manifest,
      takes: [{ ...manifest.takes[0], score: { ...manifest.takes[0].score, expectedStrikes: [] } as never }],
    }, 'take-dev-001', { repoRoot: root })).not.toThrow();
  });

  it('loads and SHA-verifies real PracticeScoreArtifact bytes before deriving expected strikes', () => {
    const { root, manifest } = fixture();
    const receipt = importContinuousPairedTake(manifest, 'take-dev-001', { repoRoot: root });
    expect(receipt.derivedExpectedStrikeCount).toBe(4);
    expect(receipt.scenario.expectedStrikes.map((strike) => strike.groupId)).toEqual(['g1', 'g2', 'g2', 'g3']);
    expect(() => importContinuousPairedTake({
      ...manifest,
      takes: [{ ...manifest.takes[0], score: { ...manifest.takes[0].score, practiceScoreArtifactSha256: 'f'.repeat(64) } }],
    }, 'take-dev-001', { repoRoot: root })).toThrow(/PracticeScoreArtifact SHA256/);
  });

  it('keeps ContinuousEvaluationSession and corpus importer on the same ExpectedStrike builder', () => {
    const { root, manifest, artifact } = fixture();
    const receipt = importContinuousPairedTake(manifest, 'take-dev-001', { repoRoot: root });
    const expected = buildContinuousExpectedStrikes({
      artifact,
      tempoSelection: manifest.takes[0].practice.tempoSelection,
      scope: manifest.takes[0].practice.scope,
    });
    expect(receipt.scenario.expectedStrikes).toEqual(expected);
    const tempoPlan = resolvePracticeTempoPlan(artifact, manifest.takes[0].practice.tempoSelection);
    const timeline = new PracticeTempoTimeline(tempoPlan, artifact.scoreEndBeat);
    const session = new ContinuousEvaluationSession({ artifact, timeline, scope: manifest.takes[0].practice.scope });
    session.advanceAnalysisThrough(1_500);
    expect(session.snapshot().strikes.map((strike) => strike.strikeId)).toEqual(expected.map((strike) => strike.strikeId));
  });

  it.each([
    ['FULL scope', { scope: { kind: 'FULL' } as PracticeScope, tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 } as PracticeTempoSelection }],
    ['RANGE scope', { scope: { kind: 'RANGE', startGroupId: 'g2', endGroupId: 'g3' } as PracticeScope, tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 } as PracticeTempoSelection }],
    ['score tempo', { scope: { kind: 'FULL' } as PracticeScope, tempoSelection: { mode: 'SCORE' } as PracticeTempoSelection }],
  ])('derives %s through product tempo/scope semantics', (_name, practice) => {
    const { root, manifest, take } = fixture();
    expect(() => importContinuousPairedTake({ ...manifest, takes: [{ ...take, practice: { ...take.practice, ...practice, completion: { kind: 'NATURAL', performanceTimeMs: 2_000 } } }] }, 'take-dev-001', { repoRoot: root })).not.toThrow();
  });

  it('allows a perfectly correct physical MIDI performance', () => {
    const { root, manifest } = fixture();
    const scenario = importContinuousPairedTakeAsBenchmarkScenario(manifest, 'take-dev-001', { repoRoot: root });
    expect(scenario.physicalGroundTruth?.attacks.map((attack) => attack.pitch)).toEqual(['C4', 'E4', 'G4', 'C4']);
  });

  it('derives physical attacks from capture artifacts and preserves retriggers and wrong notes', () => {
    const root = workspace();
    const base = fixture(root);
    const captureSha = writeJson(root, 'takes/take-dev-001.capture-events.json', {
      events: [
        { eventId: 'a', type: 'NOTE_ON', midiNote: 60, velocity: 90, performanceTimeMs: 0 },
        { eventId: 'b', type: 'NOTE_ON', midiNote: 60, velocity: 91, performanceTimeMs: 80 },
        { eventId: 'wrong', type: 'NOTE_ON', midiNote: 66, velocity: 80, performanceTimeMs: 500 },
        { eventId: 'pedal', type: 'CC', controller: 64, value: 127, performanceTimeMs: 510 },
      ],
    });
    const manifest = {
      ...base.manifest,
      takes: [{
        ...base.take,
        physicalMidi: { sourceKind: 'BROWSER_CAPTURE_EVENT_LOG' as const, path: 'takes/take-dev-001.capture-events.json', sha256: captureSha, sameTakeAudioSha256: base.take.audio.sha256 },
      }],
    };
    const scenario = importContinuousPairedTakeAsBenchmarkScenario(manifest, 'take-dev-001', { repoRoot: root });
    expect(scenario.physicalGroundTruth?.attacks.map((attack) => attack.physicalEventId)).toEqual(['a', 'b', 'wrong']);
    expect(scenario.physicalGroundTruth?.attacks.map((attack) => attack.pitch)).toEqual(['C4', 'C4', 'F#4']);
  });

  it('verifies audio, MIDI, score hashes and WAV metadata', () => {
    const { root, manifest, take } = fixture();
    expect(() => importContinuousPairedTake({ ...manifest, takes: [{ ...take, audio: { ...take.audio, sha256: 'f'.repeat(64) }, physicalMidi: { ...take.physicalMidi, sameTakeAudioSha256: 'f'.repeat(64) } }] }, 'take-dev-001', { repoRoot: root })).toThrow(/audio SHA256/);
    expect(() => importContinuousPairedTake({ ...manifest, takes: [{ ...take, physicalMidi: { ...take.physicalMidi, sha256: 'f'.repeat(64) } }] }, 'take-dev-001', { repoRoot: root })).toThrow(/physical MIDI/);
    expect(() => importContinuousPairedTake({ ...manifest, takes: [{ ...take, audio: { ...take.audio, sampleRateHz: 44_100 } }] }, 'take-dev-001', { repoRoot: root })).toThrow(/sample rate/);
  });

  it('validates source sample mapping and context-tail ownership', () => {
    const { root, manifest, take } = fixture();
    expect(() => importContinuousPairedTake({ ...manifest, takes: [{ ...take, segments: [{ ...take.segments[0], sourceContextTailEndSampleBoundary: take.segments[0].sourcePerformanceEndSampleBoundary - 1 }] }] }, 'take-dev-001', { repoRoot: root })).toThrow(/half-open/);
    expect(() => importContinuousPairedTake({ ...manifest, takes: [{ ...take, practice: { ...take.practice, completion: { kind: 'NATURAL', performanceTimeMs: 1_700 } }, segments: [{ ...take.segments[0], performanceEndMs: 1_520 }] }] }, 'take-dev-001', { repoRoot: root })).toThrow(/duration/);
  });

  it('requires calibrated synchronization metadata and uses one manifest-level split', () => {
    const { root, manifest, take } = fixture();
    expect(() => importContinuousPairedTake({ ...manifest, takes: [{ ...take, sync: { quality: 'CALIBRATED_OFFSET', method: 'manual clap' } as never }] }, 'take-dev-001', { repoRoot: root })).toThrow(/CALIBRATED_OFFSET/);
    expect('split' in take).toBe(false);
  });

  it('uses real expectedGroupIds for group taxonomy and family metrics', () => {
    const { root, manifest } = fixture();
    const scenario = importContinuousPairedTakeAsBenchmarkScenario(manifest, 'take-dev-001', { repoRoot: root });
    expect(scenario.taxonomy?.groups).toEqual({ g2: ['complete_chord'] });
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test' });
    const scored = scoreCandidate(scenario, definition, {
      candidateId: definition.candidateId,
      scenarioId: scenario.scenarioId,
      publications: [{
        publicationId: 'pub',
        analyzedThroughPerformanceMs: 1_500,
        observations: scenario.physicalGroundTruth?.attacks.map((attack) => ({ observationId: `obs-${attack.physicalEventId}`, pitch: attack.pitch, performanceTimeMs: attack.performanceTimeMs })) ?? [],
      }],
    });
    expect(scored.familyMetrics.complete_chord?.expectedStrikeRecall.sampleCount).toBeGreaterThan(0);
  });

  it('enforces EVALUATION locks', () => {
    const { manifest } = fixture();
    const evaluation = { ...manifest, split: 'EVALUATION' as const };
    const locked = { ...evaluation, evaluationLock: { locked: true, lockProjectionSha256: evaluationLockProjectionSha256(evaluation) } };
    expect(() => validateEvaluationLock(locked)).not.toThrow();
    expect(() => validateEvaluationLock({ ...locked, takes: [{ ...locked.takes[0], audio: { ...locked.takes[0].audio, sha256: 'a'.repeat(64) } }] })).toThrow(/lock/);
  });

  it('uses candidate-specific context requirements rather than a coarse 2s rule', () => {
    const { root, manifest, take } = fixture();
    const audit = auditContinuousPairedTakeCorpus({ ...manifest, takes: [{ ...take, audio: { ...take.audio, performanceOriginSourceMs: 1_800 } }] }, { repoRoot: root });
    expect(audit.scoreableTakeCount).toBe(1);
    expect(audit.candidateEligibility['online-amt-stateful-modern-compat-dev-v1']['take-dev-001']).toBe('ELIGIBLE');
  });

  it('does not let one malformed take hide audit results for other takes', () => {
    const { root, manifest, take } = fixture();
    const audit = auditContinuousPairedTakeCorpus({ ...manifest, takes: [take, { ...take, takeId: 'bad', audio: { ...take.audio, sha256: 'b'.repeat(64) }, physicalMidi: { ...take.physicalMidi, sameTakeAudioSha256: 'b'.repeat(64) } }] }, { repoRoot: root });
    expect(audit.takeCount).toBe(2);
    expect(audit.scoreableTakeCount).toBe(1);
    expect(audit.blockers.bad[0]).toMatch(/audio SHA256/);
  });

  it('detects split leakage across manifests by audio, MIDI, and capture session identities', () => {
    const { take } = fixture();
    expect(detectContinuousSplitLeakage([{ split: 'DEVELOPMENT', takes: [take] }, { split: 'EVALUATION', takes: [{ ...take, takeId: 'take-eval' }] }])).toHaveLength(3);
  });

  it('imports to the shared ContinuousFinalizationLedger scoring path and keeps synthetic empty manifests non-product', () => {
    const { root, manifest } = fixture();
    const scenario = importContinuousPairedTakeAsBenchmarkScenario(manifest, 'take-dev-001', { repoRoot: root });
    const ledger = new ContinuousFinalizationLedger({ expectedStrikes: scenario.expectedStrikes, assignmentWindowMs: 100 });
    ledger.publishObservations([{ observationId: 'obs-c4', pitch: 'C4', performanceTimeMs: 0, confidence: 1, source: 'ACOUSTIC' }], 1_500);
    ledger.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 1_500, terminalPerformanceMs: 1_500 });
    expect(ledger.completedEvaluation().status).toBe('COMPLETE');
    expect(auditContinuousPairedTakeCorpus({ ...manifest, takes: [] }, { repoRoot: root })).toMatchObject({ realRecordedTakeCount: 0, scoreableRealTakeCount: 0, productAccuracyMetric: false });
    expect(canonicalManifestSha256(manifest)).toMatch(/^[a-f0-9]{64}$/);
  });
});
