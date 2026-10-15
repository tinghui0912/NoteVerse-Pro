#!/usr/bin/env node
import path from 'node:path';
import { executeOfficialXc1StageACell } from './xc1_stage_a_candidate_registry.mjs';
import { REPO_ROOT } from './xc1_browser_runtime_shared.mjs';
import { publishOnlineAmtHops } from './xc1_online_amt_publication_bridge.mjs';
import { atomicJson, PHASE } from './xc1_artifacts.mjs';
import assert from 'node:assert/strict';
const gate = process.argv.includes('--gate');
const final = process.argv.includes('--final');
const stream = process.argv.includes('--stream');
const root = path.join(REPO_ROOT, gate ? 'backend/data/work/xc1_r3d_validation/gate_fixture' : 'backend/data/work/xc1_r3d_validation/reference_fixture');
const result = await executeOfficialXc1StageACell({ deploymentId: 'online-amt-k8-browser-v1', takeId: gate ? 'non-smd-gate' : 'non-smd-reference-p07',
  stageARoot: root, stageAManifestPath: path.join(root, 'manifest.json'), outputPath: path.join(root, stream ? 'browser_stream.json' : final ? 'browser_final.json' : 'browser.json'),
  browserChannel: 'chrome', headed: true, retainRawHops: true });
const referencePublication = publishOnlineAmtHops({ takeId: result.takeId, sampleCount: result.frozenAcousticInput.sampleCount,
  hopRows: result.rawHopRows, scoreableInterval: result.frozenAcousticInput.scoreableInterval });
assert.deepEqual(result.acousticObservations, referencePublication.acousticObservations);
assert.equal(result.canonicalPublicationDigest, referencePublication.canonicalPublicationDigest);
assert.equal(result.analyzedThroughPerformanceMs, referencePublication.analyzedThroughPerformanceMs);
assert.equal(result.totalHopCount, gate ? 112 : 326);
if (gate) {
  const boundary = result.groupRows.find(row => row.startHopIndex === 96);
  assert.equal(boundary.ortRuns.length, 4);
  assert.ok(boundary.ortRuns.every(run => run.graphKind === 'k1-fallback'));
  assert.ok(result.rawHopRows.slice(100, 104).every(row => row.chosenStates.every(state => state === 0)));
} else assert.equal(result.groupRows.filter(row => row.k === 1).length, 6);
await atomicJson(path.join(root, stream ? 'bridge_parity_stream.json' : final ? 'bridge_parity_final.json' : 'bridge_parity.json'), { phase: PHASE, status: 'AUTHORITATIVE_BRIDGE_PARITY_PASS',
  observationCount: result.acousticObservations.length, publicationCount: result.publicationCount,
  analyzedThroughPerformanceMs: result.analyzedThroughPerformanceMs, canonicalPublicationDigest: result.canonicalPublicationDigest,
  totalHopCount: result.totalHopCount, terminalResidualHopCount: gate ? 0 : 6, sourceIdentity: result.implementationIdentity });
console.log('AUTHORITATIVE_BRIDGE_PARITY_PASS');
