import { withContinuousTiming } from '@/lib/practice/__fixtures__/practice-plan';
import { describe, expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { ManualClock } from '@/lib/practice/session/timebase';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { ContinuousPracticeSession } from './domain/practice-session';
import { unavailableContinuousEvaluation } from './domain/evaluation/session';
import { ContinuousMidiEvidence } from './input/midi-evidence';
import { createNaturalContinuousCompletion } from './natural-completion';

const artifact = fixture as PracticeScoreArtifact;
describe.each(['MIDI', 'MICROPHONE'] as const)(
  '%s natural completion composition',
  (inputSource) => {
    function setup() {
      const clock = new ManualClock(0);
      const configuration = {
        plan: withContinuousTiming(
          continuousPracticePlan(artifact, { inputSource }),
          { countInTicks: 0 },
        ),
        clock,
        metadataClock: {
          nowEpochMs: () => Date.UTC(2026, 10, 5) + clock.nowMs(),
        },
      };
      const session = new ContinuousPracticeSession(
        inputSource === 'MIDI'
          ? {
              ...configuration,
              createClockEvidence: (id) => new ContinuousMidiEvidence(id),
            }
          : { ...configuration },
      );
      session.start();
      const completion = (
        identity: Partial<ReturnType<typeof session.snapshotSession>> = {},
      ) =>
        createNaturalContinuousCompletion({
          session: { ...session.snapshotSession(), ...identity },
          evaluation: unavailableContinuousEvaluation(
            inputSource,
            'CONTINUOUS_ANALYSIS_UNAVAILABLE',
          ),
          recording: { status: 'NOT_RECORDED' },
        });
      return { clock, session, completion };
    }
    it('refuses an abandoned session instead of manufacturing a partial result', () => {
      const s = setup();
      s.clock.advance(100);
      s.session.abandon();
      expect(s.session.snapshotSession().completionReason).toBe(
        'STOPPED_BY_USER',
      );
      expect(s.completion).toThrow(
        'Continuous result requires a naturally completed, ended session.',
      );
    });
    it('creates the independent result and recording only for a naturally latched scope', () => {
      const s = setup();
      s.clock.advance(s.session.clock.scopeDurationMs() + 1);
      s.session.advanceToNow();
      expect(s.session.snapshotSession().completionReason).toBe(
        'SCOPE_COMPLETED',
      );
      const completion = s.completion();
      expect(completion.result.inputKind).toBe(inputSource);
      expect(completion.result.executed.bundle.binding.bundleId).toBe(
        s.session.snapshotSession().plan.bundle.binding.bundleId,
      );
      expect(completion.result.executed.scope).toEqual(
        s.session.snapshotSession().plan.scope,
      );
      expect(completion.result.executed.tempoPlan).toEqual(
        s.session.snapshotSession().plan.tempoPlan,
      );
      expect(completion.result.executed.bundle).toBe(s.session.plan.bundle);
      expect(completion.result.completedAtMs).toBe(
        Date.UTC(2026, 10, 5) + s.clock.nowMs(),
      );
      expect(completion.recording).toEqual({ status: 'NOT_RECORDED' });
      expect(Object.isFrozen(completion)).toBe(true);
    });
  },
);
