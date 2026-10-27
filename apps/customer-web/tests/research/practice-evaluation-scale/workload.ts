import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import { assertCompletedAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation, ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';

/** Same workload before/after optimization: chords, C4 repeats at 400ms, wrong/residual and extras. */
function evaluationScaleWorkload(size: number) {
  const strikes: ContinuousExpectedStrike[] = Array.from({ length: size }, (_, i) => ({
    strikeId: `s${String(i).padStart(6, '0')}`, groupId: `g${Math.floor(i / 2)}`,
    pitch: i % 2 === 0 ? 'C4' : i % 4 === 1 ? 'E4' : 'G4', renderNoteIds: [`n${i}`],
    expectedPerformanceTimeMs: 1000 + Math.floor(i / 4) * 1600 + (i % 4 >= 2 ? 400 : 0),
  }));
  const last = strikes[strikes.length - 1].expectedPerformanceTimeMs;
  const observations: ContinuousObservation[] = strikes.map((strike, i) => ({
    observationId: `o${String(i).padStart(6, '0')}`, pitch: i % 5 === 0 ? 'B7' : i % 5 === 1 ? 'F#4' : strike.pitch,
    performanceTimeMs: i % 5 === 0 ? last + 1000 + i : strike.expectedPerformanceTimeMs,
    confidence: .9, source: 'MIDI' as const,
  })).sort((a, b) => a.performanceTimeMs - b.performanceTimeMs || a.observationId.localeCompare(b.observationId));
  const publications: ContinuousEvidencePublication[] = [];
  for (let index = 0; index < observations.length;) {
    let end = Math.min(index + 100, observations.length);
    while (end < observations.length && observations[end].performanceTimeMs === observations[end - 1].performanceTimeMs) end++;
    const batch = observations.slice(index, end), frontier = batch[batch.length - 1].performanceTimeMs;
    publications.push({ publicationId: `p${publications.length}`, sessionDomainId: 'scale',
      analyzedThroughPerformanceMs: frontier, availabilitySessionTimeMs: frontier + 250, observations: batch });
    index = end;
  }
  const terminal = observations[observations.length - 1].performanceTimeMs + 2000;
  publications.push({ publicationId: 'terminal', sessionDomainId: 'scale', analyzedThroughPerformanceMs: terminal,
    availabilitySessionTimeMs: terminal + 250, observations: [] });
  return { strikes, publications, terminal };
}

export function runEvaluationScale(size: number) {
  const started = performance.now();
  const { strikes, publications, terminal } = evaluationScaleWorkload(size);
  const finalizer = new ContinuousAssignmentFinalizer('scale', strikes);
  for (const publication of publications) finalizer.publish(publication);
  finalizer.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: terminal, availabilitySessionTimeMs: terminal + 250 });
  const completed = finalizer.completedAssignment();
  if (completed.status !== 'COMPLETE') throw Error('SCALE_COMPLETION_UNAVAILABLE');
  assertCompletedAssignment(completed.assignment);
  if (finalizer.snapshot().reservedObservationIds.length) throw Error('SCALE_UNRESOLVED_RESERVATION');
  const assignment = completed.assignment;
  return { size, publicationCount: publications.length, observationCount: assignment.observations.length,
    elapsedWallMs: performance.now() - started, completedStatus: completed.status,
    assignmentCounts: { strikes: assignment.groups.reduce((n, g) => n + g.strikes.length, 0),
      matched: assignment.observationAssignments.filter(r => r.kind === 'STRIKE_MATCH').length,
      residual: assignment.observationAssignments.filter(r => r.kind === 'GROUP_RESIDUAL').length,
      unattributed: assignment.unattributedObservations.length }, assignment };
}
