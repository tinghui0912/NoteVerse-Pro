import { withContinuousTiming } from '@/lib/practice/__fixtures__/practice-plan';
import { describe, expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { ManualClock } from '@/lib/practice/session/timebase';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { midiEvidenceProvenance, microphoneEvidenceProvenance } from '@/lib/practice/result/continuous-result-provenance';
import { ContinuousPracticeSession } from './domain/practice-session';
import { unavailableContinuousEvaluation } from './domain/evaluation/session';
import { ContinuousMidiEvidence } from './input/midi-evidence';
import { CONTINUOUS_MIDI_EVIDENCE_POLICY_ID } from './input/midi-evidence-identity';
import { createNaturalContinuousCompletion } from './natural-completion';

const artifact = fixture as PracticeScoreArtifact;
describe.each(['MIDI', 'MICROPHONE'] as const)('%s natural completion composition', inputSource => {
  function setup() {
    const clock = new ManualClock(0);
    const configuration = { plan: withContinuousTiming(continuousPracticePlan(artifact, { inputSource }), { countInTicks: 0 }), clock };
    const session = new ContinuousPracticeSession(inputSource === 'MIDI'
      ? { ...configuration, createClockEvidence: id => new ContinuousMidiEvidence(id) }
      : { ...configuration });
    session.start();
    const completion = (identity: Partial<ReturnType<typeof session.snapshotSession>> = {}) => createNaturalContinuousCompletion({
      session: { ...session.snapshotSession(), ...identity },
      evaluation: unavailableContinuousEvaluation(inputSource, 'CONTINUOUS_ANALYSIS_UNAVAILABLE'),
      evidenceProvenance: inputSource === 'MIDI' ? midiEvidenceProvenance(CONTINUOUS_MIDI_EVIDENCE_POLICY_ID) : microphoneEvidenceProvenance(48000),
      recording: { status: 'NOT_RECORDED' }, completedAt: '2026-10-26T00:00:00.000Z',
    });
    return { clock, session, completion };
  }
  it('refuses an abandoned session instead of manufacturing a partial result', () => {
    const s = setup(); s.clock.advance(100); s.session.abandon();
    expect(s.session.snapshotSession().completionReason).toBe('STOPPED_BY_USER');
    expect(s.completion).toThrow('Continuous completion requires a naturally completed scope.');
  });
  it('creates the independent result and recording only for a naturally latched scope', () => {
    const s = setup(); s.clock.advance(s.session.clock.scopeDurationMs() + 1); s.session.advanceToNow();
    expect(s.session.snapshotSession().completionReason).toBe('SCOPE_COMPLETED');
    const completion = s.completion();
    expect(completion.result.inputSource).toBe(inputSource);
    expect(completion.result.sourceId).toBe(s.session.snapshotSession().plan.source.sourceId);
    expect(completion.result.scope).toEqual(s.session.snapshotSession().plan.scope);
    expect(completion.result.tempoPlan).toEqual(s.session.snapshotSession().plan.tempoPlan);
    expect(completion.recording).toEqual({ status: 'NOT_RECORDED' });
    expect(Object.isFrozen(completion)).toBe(true);
  });
});
