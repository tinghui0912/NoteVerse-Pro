#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DEPLOYMENTS, writeArtifact, PHASE } from './xc1_artifacts.mjs';

// Frozen before inference. Confidence is diagnostic; pitch/time decide compatibility.
export const EDGE_PARITY_POLICY = Object.freeze({ timingToleranceMs: 0.1, confidenceDiagnosticTolerance: 0.001,
  unmatchedEventPolicy: 'ANY_UNMATCHED_EVENT_IS_MATERIAL_DRIFT' });
export function compareEvents(chrome, edge) {
  const sort = events => [...events].sort((a, b) => a.pitch - b.pitch || a.performanceTimeMs - b.performanceTimeMs || a.candidateObservationId.localeCompare(b.candidateObservationId));
  const a = sort(chrome), b = sort(edge);
  let pitchMismatchCount = 0, timingMismatchCount = 0, maxTimingDeltaMs = 0, maxConfidenceDelta = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    pitchMismatchCount += Number(a[index].pitch !== b[index].pitch);
    const time = Math.abs(a[index].performanceTimeMs - b[index].performanceTimeMs);
    maxTimingDeltaMs = Math.max(maxTimingDeltaMs, time);
    timingMismatchCount += Number(time > EDGE_PARITY_POLICY.timingToleranceMs);
    maxConfidenceDelta = Math.max(maxConfidenceDelta, Math.abs(a[index].confidence - b[index].confidence));
  }
  const unmatchedEventCount = Math.abs(a.length - b.length);
  return { pitchMismatchCount, timingMismatchCount, unmatchedEventCount, maxTimingDeltaMs, maxConfidenceDelta,
    decisionSemanticParity: pitchMismatchCount === 0 && timingMismatchCount === 0 && unmatchedEventCount === 0,
    confidenceDiagnosticPass: maxConfidenceDelta <= EDGE_PARITY_POLICY.confidenceDiagnosticTolerance };
}
export async function compareEdgeSubset({ chromeRoot, edgeRoot, takeIds, output, f5Commit, freezeSha256 }) {
  const rows = [];
  for (const candidate of DEPLOYMENTS) for (const takeId of takeIds) {
    const chrome = JSON.parse(await readFile(path.join(chromeRoot, candidate, `${takeId}.json`), 'utf8'));
    const edge = JSON.parse(await readFile(path.join(edgeRoot, candidate, `${takeId}.json`), 'utf8'));
    if (chrome.xc1DeploymentIdentitySha256 !== edge.xc1DeploymentIdentitySha256) throw new Error('XC1_EDGE_DEPLOYMENT_DRIFT');
    rows.push({ candidate, takeId, ...compareEvents(chrome.acousticObservations, edge.acousticObservations) });
  }
  return writeArtifact(output, { phase: PHASE, f5Commit, f5FreezeSha256: freezeSha256, policy: EDGE_PARITY_POLICY,
    rows, fullEdgeExpansionRequired: DEPLOYMENTS.filter(candidate => rows.some(row => row.candidate === candidate && !row.decisionSemanticParity)) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].slice(2)] = process.argv[index + 1];
  const freeze = JSON.parse(await readFile(args.freeze, 'utf8'));
  compareEdgeSubset({ chromeRoot: args['chrome-root'], edgeRoot: args['edge-root'], takeIds: freeze.edgeSubsetTakeIds,
    output: args.output, f5Commit: args['f5-commit'], freezeSha256: freeze.freezeSha256 })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
