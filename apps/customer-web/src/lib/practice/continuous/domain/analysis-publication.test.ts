import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { ContinuousPracticeSession } from '@/lib/practice/continuous/domain/practice-session';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { ManualClock, type SessionTime } from '@/lib/practice/kernel/timebase';
import { describe, expect, it } from 'vitest';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
const defaultTempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
describe('Continuous analysis publication admission', () => {

  it('keeps completion separate from future asynchronous analysis frontier', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    session.start();
    clock.advance(1000);
    session.end('STOPPED_BY_USER');
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes).some((strike) => strike.state === 'PENDING')).toBe(true);

    session.publishAnalysis({
      publicationId: 'publication-32484', sessionDomainId: session.timebase.domainId,
      analyzedThroughPerformanceMs: 1000, availabilityTimeMs: 1000,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-32484:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: session.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    });
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes).some((strike) => strike.state === 'UNMATCHED')).toBe(true);
  });

  it('rejects analysis publications before performance evidence time exists', () => {
    const ready = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: new ManualClock(0),
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    const readyBefore = ready.evaluationSnapshot;
    expect(() => ready.publishAnalysis({
      publicationId: 'publication-33169', sessionDomainId: ready.timebase.domainId,
      analyzedThroughPerformanceMs: 0, availabilityTimeMs: 0,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-33169:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: ready.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/requires captured performance evidence time/);
    expect(ready.evaluationSnapshot).toEqual(readyBefore);

    const countIn = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: new ManualClock(0),
      inputSource: 'MICROPHONE',
      countInBeats: 1
    });
    countIn.start();
    const countInBefore = countIn.evaluationSnapshot;
    expect(countIn.snapshot().state).toBe('COUNT_IN');
    expect(() => countIn.publishAnalysis({
      publicationId: 'publication-33821', sessionDomainId: countIn.timebase.domainId,
      analyzedThroughPerformanceMs: 0, availabilityTimeMs: 0,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-33821:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: countIn.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/requires captured performance evidence time/);
    expect(countIn.evaluationSnapshot).toEqual(countInBefore);
  });

  it('rejects analysis publication beyond current running performance time without mutation', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    session.start();
    clock.advance(1000);
    const before = session.evaluationSnapshot;

    expect(() => session.publishAnalysis({
      publicationId: 'publication-34573', sessionDomainId: session.timebase.domainId,
      analyzedThroughPerformanceMs: 2000, availabilityTimeMs: 2000,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-34573:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: session.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/beyond captured performance time/);
    expect(session.evaluationSnapshot).toEqual(before);
  });

  it('rejects analysis publication beyond paused and stopped performance time', () => {
    const pausedClock = new ManualClock(0);
    const paused = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: pausedClock,
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    paused.start();
    pausedClock.advance(1000);
    paused.pause();
    pausedClock.advance(5000);
    const pausedBefore = paused.evaluationSnapshot;
    expect(() => paused.publishAnalysis({
      publicationId: 'publication-35374', sessionDomainId: paused.timebase.domainId,
      analyzedThroughPerformanceMs: 1001, availabilityTimeMs: 1001,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-35374:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: paused.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/beyond captured performance time/);
    expect(paused.evaluationSnapshot).toEqual(pausedBefore);

    const stoppedClock = new ManualClock(0);
    const stopped = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: stoppedClock,
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    stopped.start();
    stoppedClock.advance(1000);
    stopped.end('STOPPED_BY_USER');
    const stoppedBefore = stopped.evaluationSnapshot;
    expect(() => stopped.publishAnalysis({
      publicationId: 'publication-36075', sessionDomainId: stopped.timebase.domainId,
      analyzedThroughPerformanceMs: 1001, availabilityTimeMs: 1001,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-36075:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: stopped.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/beyond captured performance time/);
    expect(stopped.evaluationSnapshot).toEqual(stoppedBefore);
  });

  it('accepts natural terminal analysis frontier at the resolved scope terminal', () => {
    const rangeClock = new ManualClock(0);
    const range = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[0].groupId,
        endGroupId: artifact.expectedPracticeGroups[0].groupId,
      },
      clock: rangeClock,
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    range.start();
    rangeClock.advance(10_000);
    expect(range.snapshot().completionReason).toBe('SCOPE_COMPLETED');

    expect(() => range.publishAnalysis({
      publicationId: 'publication-36999', sessionDomainId: range.timebase.domainId,
      analyzedThroughPerformanceMs: range.snapshot().performanceTimeMs, availabilityTimeMs: range.snapshot().performanceTimeMs,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-36999:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: range.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).not.toThrow();
  });

  it('rejects post-terminal analysis publication that moves the performance frontier backwards', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    session.start();
    clock.advance(1000);
    session.end('STOPPED_BY_USER');

    session.publishAnalysis({
      publicationId: 'publication-37656', sessionDomainId: session.timebase.domainId,
      analyzedThroughPerformanceMs: 1000, availabilityTimeMs: 1000,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-37656:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: session.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    });
    const afterForward = session.evaluationSnapshot;
    expect(() => session.publishAnalysis({
      publicationId: 'publication-37877', sessionDomainId: session.timebase.domainId,
      analyzedThroughPerformanceMs: 100, availabilityTimeMs: 100,
      observations: ([]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-37877:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: session.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/PUBLICATION_AFTER_COMPLETION/);

    expect(session.evaluationSnapshot).toEqual(afterForward);
  });

  it('rejects cross-session analysis publication without mutating evaluation', () => {
    const clockA = new ManualClock(0);
    const sessionA = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: clockA,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session-a'
    });
    const clockB = new ManualClock(0);
    const sessionB = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: clockB,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session-b'
    });
    sessionA.start();
    sessionB.start();
    clockB.advance(1000);
    const before = sessionB.evaluationSnapshot;

    expect(() => sessionB.publishAnalysis({
      publicationId: 'publication-38978', sessionDomainId: sessionA.timebase.domainId,
      analyzedThroughPerformanceMs: 1000, availabilityTimeMs: 1000,
      observations: ([{
        captureTime: sessionA.timebase.atSessionMs(100),
        pitch: 'C4',
        confidence: 1,
        source: 'ACOUSTIC' as const,
      }]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-38978:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: sessionB.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/different session domain/);

    expect(sessionB.evaluationSnapshot).toEqual(before);
  });

  it('rejects a publication from the wrong performance domain before advancing analysis', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session'
    });
    session.start();
    clock.advance(1000);
    const before = session.evaluationSnapshot;

    expect(() => session.publishAnalysis({
      publicationId: 'publication-39883', sessionDomainId: 'wrong-domain',
      analyzedThroughPerformanceMs: 1000, availabilityTimeMs: 1000,
      observations: ([{
        captureTime: { domainId: 'wrong-domain', ms: 100 },
        pitch: 'C4',
        confidence: 1,
        source: 'ACOUSTIC' as const,
      }]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-39883:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: session.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/different session domain/);

    expect(session.evaluationSnapshot).toEqual(before);
  });

  it('rejects invalid analysis frontiers atomically before observing attacks', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session'
    });
    session.start();
    clock.advance(1000);
    const before = session.evaluationSnapshot;

    expect(() => session.publishAnalysis({
      publicationId: 'publication-42062', sessionDomainId: session.timebase.domainId,
      analyzedThroughPerformanceMs: Number.POSITIVE_INFINITY, availabilityTimeMs: Number.POSITIVE_INFINITY,
      observations: ([{
        captureTime: session.timebase.atSessionMs(100),
        pitch: 'C4',
        confidence: 1,
        source: 'ACOUSTIC' as const,
      }]).map((attack: AnalysisAttackFixture, index: number) => ({
        observationId: 'publication-42062:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
        performanceTimeMs: session.clock.performanceTimeAtCapture(attack.captureTime.ms) ?? -1,
      })),
    })).toThrow(/analysis frontier/);

    expect(session.evaluationSnapshot).toEqual(before);
  });
});

type AnalysisAttackFixture = { captureTime: SessionTime; pitch: string; confidence: number; source: 'ACOUSTIC' };

it('rejects a mixed valid/invalid observation batch atomically', () => {
  const clock = new ManualClock(0);
  const session = new ContinuousPracticeSession({
    artifact,
    tempoPlan: defaultTempoPlan,
    scope: { kind: 'FULL' },
    clock,
    inputSource: 'MICROPHONE',
    countInBeats: 0,
    localSessionId: 'analysis-session'
  });
  session.start();
  clock.advance(1000);
  const before = session.evaluationSnapshot;

  expect(() => session.publishAnalysis({
    publicationId: 'publication-40802', sessionDomainId: session.timebase.domainId,
    analyzedThroughPerformanceMs: 1000, availabilityTimeMs: 1000,
    observations: ([
      {
        captureTime: session.timebase.atSessionMs(100),
        pitch: 'C4',
        confidence: 1,
        source: 'ACOUSTIC' as const,
      },
      {
        captureTime: session.timebase.atSessionMs(200),
        pitch: 'E4',
        confidence: 1,
        source: 'ACOUSTIC' as const,
      },
      {
        captureTime: { domainId: 'wrong-domain', ms: 300 },
        pitch: 'G4',
        confidence: 1,
        source: 'ACOUSTIC' as const,
      },
    ]).map((attack: AnalysisAttackFixture, index: number) => ({
      observationId: 'publication-40802:' + index, pitch: attack.pitch, confidence: attack.confidence, source: attack.source,
      performanceTimeMs: attack.captureTime.domainId === 'wrong-domain' ? 1001 : 100,
    })),
  })).toThrow(/INVALID_PUBLICATION/);

  expect(session.evaluationSnapshot).toEqual(before);
});
