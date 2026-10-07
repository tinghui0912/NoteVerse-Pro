import type { LocalPracticeCompletionReason } from './session';
import {
  assignObservedAttacksToExpectedStrikes,
  validateAssignmentWindow,
  type ExpectedStrike,
  type ReconciledStrike,
} from '../audio-analysis/continuous/performance-reconciler';
import type { ObservedAttack } from '../audio-analysis/continuous/observed-attack';
import type { CompletedContinuousEvaluation } from '../completed-performance';

export type ContinuousEvaluationSnapshot = {
  strikes: readonly ReconciledStrike[];
  extras: readonly ObservedAttack[];
};

class ContinuousEvaluationLateEvidenceError extends Error {
  readonly code = 'CONTINUOUS_EVALUATION_LATE_EVIDENCE' as const;

  constructor(message = 'Continuous evidence cannot be published behind the declared analysis coverage watermark.') {
    super(message);
    this.name = 'ContinuousEvaluationLateEvidenceError';
  }
}

type StrikeConflictComponent = {
  id: string;
  pitch: string;
  strikeIndices: readonly number[];
  legalEndMs: number;
};

export type ContinuousFinalizationLedgerOptions = {
  expectedStrikes: readonly ExpectedStrike[];
  assignmentWindowMs: number;
};

export class ContinuousFinalizationLedger {
  private readonly expectedStrikes: ExpectedStrike[];
  private readonly assignmentWindowMs: number;
  private readonly conflictComponents: StrikeConflictComponent[];
  private readonly observedAttacks: ObservedAttack[] = [];
  private readonly observationById = new Map<string, ObservedAttack>();
  private readonly finalizedStrikes = new Map<number, ReconciledStrike>();
  private readonly finalizedComponentIds = new Set<string>();
  private readonly consumedObservationIds = new Set<string>();
  private readonly finalizedExtras = new Map<string, ObservedAttack>();
  private analyzedThroughPerformanceMs: number | null = null;
  private completion:
    | { kind: 'LIVE' }
    | { kind: 'NATURAL'; terminalPerformanceMs: number }
    | { kind: 'MANUAL'; stoppedAtPerformanceMs: number } = { kind: 'LIVE' };

  constructor(options: ContinuousFinalizationLedgerOptions) {
    this.assignmentWindowMs = options.assignmentWindowMs;
    validateAssignmentWindow(this.assignmentWindowMs);
    this.expectedStrikes = options.expectedStrikes.map((strike) => ({
      ...strike,
      renderNoteIds: [...strike.renderNoteIds],
    }));
    this.conflictComponents = buildConflictComponents(this.expectedStrikes, this.assignmentWindowMs);
  }

  observeAttack(attack: ObservedAttack): void {
    this.validateObservation(attack);
    const existing = this.observationById.get(attack.observationId);
    if (existing) {
      if (observedAttacksEqual(existing, attack)) {
        return;
      }
      throw new Error(`Continuous observationId already exists with different evidence: ${attack.observationId}`);
    }
    if (this.wouldMutateFinalizedTruth(attack)) {
      throw new ContinuousEvaluationLateEvidenceError();
    }
    const stored = { ...attack };
    this.observedAttacks.push(stored);
    this.observationById.set(stored.observationId, stored);
    this.finalizeReadyTruth();
  }

  publishObservations(attacks: readonly ObservedAttack[], analyzedThroughPerformanceMs: number): void {
    this.validateFrontier(analyzedThroughPerformanceMs);
    const existingIds = new Set<string>();
    for (const attack of attacks) {
      this.validateObservation(attack);
      if (attack.performanceTimeMs > analyzedThroughPerformanceMs) {
        throw new Error('Continuous publication cannot include evidence beyond its analysis frontier.');
      }
      if (existingIds.has(attack.observationId)) {
        throw new Error(`Continuous publication contains duplicate observationId: ${attack.observationId}`);
      }
      existingIds.add(attack.observationId);
      const existing = this.observationById.get(attack.observationId);
      if (existing && !observedAttacksEqual(existing, attack)) {
        throw new Error(`Continuous observationId already exists with different evidence: ${attack.observationId}`);
      }
      if (!existing && this.wouldMutateFinalizedTruth(attack)) {
        throw new ContinuousEvaluationLateEvidenceError();
      }
    }
    for (const attack of attacks) {
      if (this.observationById.has(attack.observationId)) {
        continue;
      }
      const stored = { ...attack };
      this.observedAttacks.push(stored);
      this.observationById.set(stored.observationId, stored);
    }
    this.analyzedThroughPerformanceMs = analyzedThroughPerformanceMs;
    this.finalizeReadyTruth();
  }

  advanceAnalysisThrough(performanceTimeMs: number): void {
    this.validateFrontier(performanceTimeMs);
    this.analyzedThroughPerformanceMs = performanceTimeMs;
    this.finalizeReadyTruth();
  }

  complete(input: {
    reason: LocalPracticeCompletionReason;
    performanceTimeMs: number;
    terminalPerformanceMs: number;
  }): void {
    this.completion = input.reason === 'SCOPE_COMPLETED'
      ? { kind: 'NATURAL', terminalPerformanceMs: input.terminalPerformanceMs }
      : { kind: 'MANUAL', stoppedAtPerformanceMs: input.performanceTimeMs };
    this.finalizeReadyTruth();
  }

  snapshot(): ContinuousEvaluationSnapshot {
    return {
      strikes: this.expectedStrikes.map((strike, index) => (
        this.finalizedStrikes.get(index) ?? { ...strike, verdict: 'PENDING' }
      )),
      extras: [...this.finalizedExtras.values()].map((attack) => ({ ...attack })),
    };
  }

  completedEvaluation(): CompletedContinuousEvaluation {
    const snapshot = this.snapshot();
    if (snapshot.strikes.some((strike) => strike.verdict === 'PENDING')) {
      return { status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' };
    }
    return {
      status: 'COMPLETE',
      strikes: snapshot.strikes.map((strike) => {
        if (strike.verdict === 'MATCHED') {
          const attack = this.observedAttacks.find((item) => item.observationId === strike.matchedObservationId);
          if (!attack) {
            throw new Error('Matched strike references an unknown observed attack.');
          }
          return {
            strikeId: strike.strikeId,
            expectedGroupId: strike.groupId,
            pitch: strike.pitch,
            performanceTimeMs: strike.expectedPerformanceTimeMs,
            renderNoteIds: [...strike.renderNoteIds],
            result: 'MATCHED',
            matchedObservationId: attack.observationId,
            confidence: attack.confidence,
            source: attack.source,
            timingOffsetMs: strike.timingOffsetMs,
          };
        }
        if (strike.verdict === 'MISSING' || strike.verdict === 'NOT_REACHED') {
          return {
            strikeId: strike.strikeId,
            expectedGroupId: strike.groupId,
            pitch: strike.pitch,
            performanceTimeMs: strike.expectedPerformanceTimeMs,
            renderNoteIds: [...strike.renderNoteIds],
            result: strike.verdict,
          };
        }
        throw new Error('Pending strikes cannot be converted to completed evaluation.');
      }),
      extras: snapshot.extras.map((attack) => ({ ...attack })),
    };
  }

  private finalizeReadyTruth(): void {
    for (const component of this.conflictComponents) {
      if (this.finalizedComponentIds.has(component.id)) {
        continue;
      }
      const closeAtMs = this.componentClosureMs(component);
      if (this.analyzedThroughPerformanceMs === null || this.analyzedThroughPerformanceMs < closeAtMs) {
        continue;
      }
      this.finalizeComponent(component);
    }
    this.finalizeExtras();
  }

  private finalizeComponent(component: StrikeConflictComponent): void {
    const expectedStrikes = component.strikeIndices.map((index) => this.expectedStrikes[index]);
    const observedAttacks = this.observedAttacks.filter((attack) => (
      attack.pitch === component.pitch
      && !this.consumedObservationIds.has(attack.observationId)
      && !this.finalizedExtras.has(attack.observationId)
      && expectedStrikes.some((strike) =>
        Math.abs(attack.performanceTimeMs - strike.expectedPerformanceTimeMs) <= this.assignmentWindowMs
      )
    ));
    const assignments = assignObservedAttacksToExpectedStrikes({
      expectedStrikes,
      observedAttacks,
      assignmentWindowMs: this.assignmentWindowMs,
    });
    const assignedLocalStrikeIndices = new Set(assignments.keys());
    for (const [localStrikeIndex, localObservationIndex] of assignments) {
      const globalStrikeIndex = component.strikeIndices[localStrikeIndex];
      const strike = this.expectedStrikes[globalStrikeIndex];
      const observation = observedAttacks[localObservationIndex];
      this.finalizedStrikes.set(globalStrikeIndex, {
        ...strike,
        verdict: 'MATCHED',
        matchedObservationId: observation.observationId,
        timingOffsetMs: observation.performanceTimeMs - strike.expectedPerformanceTimeMs,
      });
      this.consumedObservationIds.add(observation.observationId);
    }
    for (let localStrikeIndex = 0; localStrikeIndex < component.strikeIndices.length; localStrikeIndex += 1) {
      if (assignedLocalStrikeIndices.has(localStrikeIndex)) {
        continue;
      }
      const globalStrikeIndex = component.strikeIndices[localStrikeIndex];
      const strike = this.expectedStrikes[globalStrikeIndex];
      this.finalizedStrikes.set(globalStrikeIndex, {
        ...strike,
        verdict: this.unmatchedFinalVerdict(strike),
      });
    }
    this.finalizedComponentIds.add(component.id);
  }

  private finalizeExtras(): void {
    for (const attack of this.observedAttacks) {
      if (this.consumedObservationIds.has(attack.observationId) || this.finalizedExtras.has(attack.observationId)) {
        continue;
      }
      if (
        !this.canMatchUnfinalizedComponent(attack)
        && this.analyzedThroughPerformanceMs !== null
        && attack.performanceTimeMs <= this.analyzedThroughPerformanceMs
      ) {
        this.finalizedExtras.set(attack.observationId, { ...attack });
      }
    }
  }

  private componentClosureMs(component: StrikeConflictComponent): number {
    if (this.completion.kind === 'MANUAL') {
      return Math.min(component.legalEndMs, this.completion.stoppedAtPerformanceMs);
    }
    if (this.completion.kind === 'NATURAL') {
      return Math.min(component.legalEndMs, this.completion.terminalPerformanceMs);
    }
    return component.legalEndMs;
  }

  private unmatchedFinalVerdict(strike: ExpectedStrike): 'MISSING' | 'NOT_REACHED' {
    if (
      this.completion.kind === 'MANUAL'
      && strike.expectedPerformanceTimeMs + this.assignmentWindowMs > this.completion.stoppedAtPerformanceMs
    ) {
      return 'NOT_REACHED';
    }
    return 'MISSING';
  }

  private validateFrontier(performanceTimeMs: number): void {
    if (!Number.isFinite(performanceTimeMs) || performanceTimeMs < 0) {
      throw new Error('Continuous analysis frontier must be finite and non-negative.');
    }
    if (this.analyzedThroughPerformanceMs !== null && performanceTimeMs < this.analyzedThroughPerformanceMs) {
      throw new Error('Continuous analysis frontier must be monotonic.');
    }
  }

  private validateObservation(attack: ObservedAttack): void {
    if (
      !attack.observationId
      || !attack.pitch
      || !Number.isFinite(attack.performanceTimeMs)
      || attack.performanceTimeMs < 0
      || !Number.isFinite(attack.confidence)
    ) {
      throw new Error('Continuous observation must have finite time, confidence, pitch, and identity.');
    }
  }

  private wouldMutateFinalizedTruth(attack: ObservedAttack): boolean {
    const matchesFinalizedComponent = this.conflictComponents.some((component) => (
      this.finalizedComponentIds.has(component.id)
      && component.pitch === attack.pitch
      && component.strikeIndices.some((strikeIndex) =>
        Math.abs(attack.performanceTimeMs - this.expectedStrikes[strikeIndex].expectedPerformanceTimeMs)
          <= this.assignmentWindowMs
      )
    ));
    if (matchesFinalizedComponent) {
      return true;
    }
    return this.analyzedThroughPerformanceMs !== null
      && attack.performanceTimeMs <= this.analyzedThroughPerformanceMs;
  }

  private canMatchUnfinalizedComponent(attack: ObservedAttack): boolean {
    return this.conflictComponents.some((component) => (
      !this.finalizedComponentIds.has(component.id)
      && component.pitch === attack.pitch
      && component.strikeIndices.some((strikeIndex) =>
        Math.abs(attack.performanceTimeMs - this.expectedStrikes[strikeIndex].expectedPerformanceTimeMs)
          <= this.assignmentWindowMs
      )
    ));
  }
}

function buildConflictComponents(
  expectedStrikes: readonly ExpectedStrike[],
  assignmentWindowMs: number
): StrikeConflictComponent[] {
  const byPitch = new Map<string, { strike: ExpectedStrike; index: number; start: number; end: number }[]>();
  expectedStrikes.forEach((strike, index) => {
    const list = byPitch.get(strike.pitch) ?? [];
    list.push({
      strike,
      index,
      start: strike.expectedPerformanceTimeMs - assignmentWindowMs,
      end: strike.expectedPerformanceTimeMs + assignmentWindowMs,
    });
    byPitch.set(strike.pitch, list);
  });
  const components: StrikeConflictComponent[] = [];
  for (const [pitch, intervals] of byPitch) {
    const sorted = intervals.slice().sort((left, right) =>
      left.start - right.start || left.end - right.end || left.index - right.index
    );
    let current: typeof sorted = [];
    let currentEnd = Number.NEGATIVE_INFINITY;
    for (const interval of sorted) {
      if (current.length === 0 || interval.start <= currentEnd) {
        current.push(interval);
        currentEnd = Math.max(currentEnd, interval.end);
        continue;
      }
      components.push(componentFromIntervals(pitch, current, components.length));
      current = [interval];
      currentEnd = interval.end;
    }
    if (current.length > 0) {
      components.push(componentFromIntervals(pitch, current, components.length));
    }
  }
  return components;
}

function componentFromIntervals(
  pitch: string,
  intervals: readonly { index: number; start: number; end: number }[],
  componentIndex: number
): StrikeConflictComponent {
  return {
    id: `${pitch}:${componentIndex}`,
    pitch,
    strikeIndices: intervals.map((interval) => interval.index),
    legalEndMs: Math.max(...intervals.map((interval) => interval.end)),
  };
}

function observedAttacksEqual(left: ObservedAttack, right: ObservedAttack): boolean {
  return left.observationId === right.observationId
    && left.pitch === right.pitch
    && left.performanceTimeMs === right.performanceTimeMs
    && left.confidence === right.confidence
    && left.source === right.source;
}
