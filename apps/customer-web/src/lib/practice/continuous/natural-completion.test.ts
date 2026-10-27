import { describe, expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { resolvePracticeTempoPlan } from '@/lib/practice/kernel/tempo';
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
    const configuration = { artifact, scope: { kind: 'FULL' as const }, clock, countInBeats: 0 };
    const session = new ContinuousPracticeSession(inputSource === 'MIDI'
      ? { ...configuration, inputSource, createClockEvidence: id => new ContinuousMidiEvidence(id) }
      : { ...configuration, inputSource });
    session.start();
    const completion = () => createNaturalContinuousCompletion({
      session: session.snapshotSession(), artifact, scope: configuration.scope,
      tempoPlan: resolvePracticeTempoPlan(artifact, { mode: 'SCORE' }),
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
    expect(completion.recording).toEqual({ status: 'NOT_RECORDED' });
    expect(Object.isFrozen(completion)).toBe(true);
  });
});
