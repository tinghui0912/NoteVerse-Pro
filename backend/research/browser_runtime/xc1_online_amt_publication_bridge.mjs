import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO_ROOT, RUNTIME_NODE_MODULES } from './xc1_browser_runtime_shared.mjs';
import { digest } from './xc1_artifacts.mjs';

const require = createRequire(import.meta.url);
const { createJiti } = require(path.join(RUNTIME_NODE_MODULES, 'jiti'));
const bridge = createJiti(import.meta.url)(path.join(REPO_ROOT,
  'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));
export function midiPitchName(midi) {
  return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12] + (Math.floor(midi / 12) - 1);
}
export function pitchNameMidi(pitch) {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(pitch);
  if (!match) throw new Error('XC1_INVALID_PITCH_NAME');
  return (Number(match[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] + (match[2] ? 1 : 0);
}
export function publishOnlineAmtHops({ takeId, sampleCount, hopRows, scoreableInterval }) {
  const artifact = { schemaVersion: 1, artifact: 'online_amt_real_hop_output', segments: [{
    segmentId: takeId, performanceStartMs: 0, performanceOwnedSamples: sampleCount, contextTailSamples: 0,
    hops: hopRows.map(row => ({ hopIndex: row.hopIndex, localDecisionSample: (row.hopIndex + 1) * 512,
      pitchStates: Array.from({ length: 88 }, (_, index) => ({ pitch: midiPitchName(index + 21),
        probabilities: row.probabilities.slice(index * 5, (index + 1) * 5), chosenState: row.chosenStates[index] })) })),
  }] };
  // Scenario metadata is constructed downstream of inference solely to satisfy the
  // historical bridge's coverage validator. No score or expected strikes are used.
  const run = bridge.runOnlineAmtStreamingCandidateFromHopArtifact({
    scenario: { scenarioId: takeId, audio: { clipEndMs: sampleCount / 16, performanceOriginSourceMs: 0 },
      completion: { performanceTimeMs: sampleCount / 16 } },
    artifact, candidateId: 'online-amt-calibrated-v1', command: 'XC1 acoustic publication bridge', runtime: 'ORT Web 1.30.0',
  });
  const publications = run.publications.map(publication => ({ publicationId: publication.publicationId,
    analyzedThroughPerformanceMs: publication.analyzedThroughPerformanceMs, observations: publication.observations }));
  const acousticObservations = publications.flatMap(publication => publication.observations)
    .filter(observation => observation.performanceTimeMs >= scoreableInterval.startMs && observation.performanceTimeMs < scoreableInterval.endMs)
    .map(observation => ({ ...observation, candidateObservationId: observation.observationId, pitch: pitchNameMidi(observation.pitch) }));
  return { acousticObservations, publicationCount: publications.length,
    observationCountBeforeInteriorFiltering: publications.reduce((sum, publication) => sum + publication.observations.length, 0),
    analyzedThroughPerformanceMs: publications.at(-1)?.analyzedThroughPerformanceMs ?? null,
    canonicalPublicationDigest: digest(publications), publications };
}
