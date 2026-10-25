import { describe, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { ContinuousEvaluationSession } from './evaluation/session';
import { ContinuousPracticeSession } from './practice-session';

const artifact = fixture as PracticeScoreArtifact;

describe('Continuous clock evidence composition', () => {
  it('requires an explicitly composed MIDI evidence owner', () => {
    expect(() => new ContinuousPracticeSession({
      artifact, scope: { kind: 'FULL' }, clock: new ManualClock(), inputSource: 'MIDI',
    })).toThrow('MIDI sessions require a clock evidence input.');
  });

  it('does not construct a clock evidence owner for microphone analysis', () => {
    const createClockEvidence = vi.fn();
    new ContinuousPracticeSession({
      artifact, scope: { kind: 'FULL' }, clock: new ManualClock(), createClockEvidence,
    });
    expect(createClockEvidence).not.toHaveBeenCalled();
  });

  it('publishes terminal MIDI coverage before completing evaluation, exactly once', () => {
    const events: string[] = [];
    const clock = new ManualClock();
    const originalComplete = ContinuousEvaluationSession.prototype.complete;
    const completion = vi.spyOn(ContinuousEvaluationSession.prototype, 'complete').mockImplementation(function (this: ContinuousEvaluationSession, ...args) {
      events.push('evaluation');
      return originalComplete.apply(this, args);
    });
    try {
      const session = new ContinuousPracticeSession({
        artifact, scope: { kind: 'FULL' }, clock, inputSource: 'MIDI', countInBeats: 0,
        createClockEvidence: domainId => {
          const evidence = new ContinuousMidiEvidence(domainId);
          return {
            observe: (...args) => evidence.observe(...args),
            advance: snapshot => evidence.advance(snapshot),
            complete: snapshot => {
              events.push('coverage');
              return evidence.complete(snapshot);
            },
          };
        },
      });
      session.start();
      clock.advance(100);
      session.observeCapturedAttack({
        pitch: 'C4', confidence: 1, source: 'MIDI', captureTime: session.timebase.atSessionMs(0),
      });
      session.end();
      session.snapshot();
      session.evaluationSnapshot;
      expect(events).toEqual(['coverage', 'evaluation']);
      const evaluation = session.completedEvaluation();
      expect(evaluation.status).toBe('COMPLETE');
      if (evaluation.status === 'COMPLETE') {
        expect(evaluation.groups[0].strikes[0]).toMatchObject({ state: 'MATCHED' });
      }
    } finally {
      completion.mockRestore();
    }
  });
});
