import * as countInContract from "./count-in";
import * as resourceContract from "./resource-plan";
import { planPracticeResources } from "./resource-plan";
import { beforeEach, expect, it, vi } from "vitest";
import fixture from "../__fixtures__/canonical-practice-score-artifact.json";
import type { PracticeScoreArtifact } from "../score/artifact";
import { planPractice } from "./practice-plan";
import type { PracticeIntent } from "./intent";
import * as scopeContract from "./scope";
import * as tempoContract from "./tempo";
import { ManualClock } from "../session/timebase";
import { StepPracticeSession } from "../step/domain/practice-session";
import { ContinuousPracticeSession } from "../continuous/domain/practice-session";
import { ContinuousMidiEvidence } from "../continuous/input/midi-evidence";
import { createNaturalContinuousCompletion } from "../continuous/natural-completion";
import { midiEvidenceProvenance } from "../result/continuous-result-provenance";
import { CONTINUOUS_MIDI_EVIDENCE_POLICY_ID } from "../continuous/input/midi-evidence-identity";

const intent: PracticeIntent = {
  mode: "STEP_BY_STEP",
  inputSource: "MIDI",
  recordingMode: "OFF",
  scope: { kind: "FULL" },
  tempoSelection: { mode: "SCORE" },
  metronomeEnabled: false,
};
const source = () => ({
  sourceId: "canonical-source",
  musicXml: "<score-partwise/>",
  artifact: structuredClone(fixture) as PracticeScoreArtifact,
});
beforeEach(() => vi.restoreAllMocks());
it("deterministically retains canonical source and artifact identities", () => {
  const input = source();
  const first = planPractice(input, intent),
    second = planPractice(input, structuredClone(intent));
  expect(first.resources).toEqual(planPracticeResources(intent));
  expect(first).toEqual(second);
  expect(first.source.artifact).toBe(input.artifact);
  expect(first.source.sourceId).toBe(input.sourceId);
  expect(Object.keys(first.source).sort()).toEqual(["artifact", "sourceId"]);
  expect(Object.keys(first).sort()).toEqual(
    [
      "resources",
      "source",
      "mode",
      "scope",
      "tempoPlan",
      "metronomePlan",
    ].sort(),
  );
});
it("resolves FULL and RANGE and SCORE and CUSTOM_FIXED_BPM", () => {
  const input = source();
  const full = planPractice(input, intent);
  const range = planPractice(input, {
    ...intent,
    scope: {
      kind: "RANGE",
      startGroupId: input.artifact.moments[1].groupId,
      endGroupId: input.artifact.moments[2].groupId,
    },
    tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 100 },
  });
  expect(full.scope).toMatchObject({
    startIndex: 0,
    endIndex: 4,
    terminalTick: input.artifact.scoreEndTick,
  });
  expect(range.scope).toMatchObject({
    startIndex: 1,
    endIndex: 2,
    startTick: input.artifact.moments[1].onsetTick,
    terminalTick: input.artifact.moments[2].canonicalEndTick,
  });
  expect(full.tempoPlan.segments).toHaveLength(2);
  expect(range.tempoPlan.segments).toEqual([
    { startTick: 0, bpm: 100, source: "CUSTOM" },
  ]);
});
it.each(["", null, 123])("rejects invalid source id %s", (sourceId) => {
  expect(() =>
    planPractice({ ...source(), sourceId } as never, intent),
  ).toThrow();
});
it("rejects invalid scope, tempo, mode and recording choices without repair", () => {
  for (const fields of [
    {
      scope: { kind: "RANGE", startGroupId: "missing", endGroupId: "missing" },
    },
    { scope: { kind: "OTHER" } },
    { tempoSelection: { mode: "OTHER" } },
    { tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 300 } },
    { recordingMode: "AUDIO" },
    { mode: "OTHER" },
  ]) {
    expect(() =>
      planPractice(source(), { ...intent, ...fields } as never),
    ).toThrow();
  }
});
it("freezes plan-owned structures including selection and canonical notation", () => {
  const plan = planPractice(source(), intent);
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.scope)).toBe(true);
  expect(Object.isFrozen(plan.tempoPlan)).toBe(true);
  expect(Object.isFrozen(plan.tempoPlan.selection)).toBe(true);
  expect(() => Object.assign(plan.scope, { startIndex: 3 })).toThrow();
  expect(() =>
    Object.assign(plan.tempoPlan.segments[0], { bpm: 70 }),
  ).toThrow();
  expect(() =>
    plan.source.artifact.moments[0].attacks.push(
      plan.source.artifact.moments[1].attacks[0],
    ),
  ).toThrow();
});
it("pure planning is independent of invocation history and initial metronome choice", () => {
  const input = source();
  const off = planPractice(input, intent);
  const on = planPractice(input, { ...intent, metronomeEnabled: true });
  planPractice(source(), { ...intent, inputSource: "MICROPHONE" });
  expect(planPractice(structuredClone(input), structuredClone(intent))).toEqual(
    off,
  );
  expect(on.scope).toEqual(off.scope);
  expect(on.tempoPlan).toEqual(off.tempoPlan);
  expect(on.resources).toEqual(off.resources);
  expect(on.metronomePlan.initiallyEnabled).toBe(true);
  expect(off.metronomePlan.initiallyEnabled).toBe(false);
  expect(on.metronomePlan.tempoPlan).toBe(on.tempoPlan);
});
it("STEP executes the exact planned scope and tempo through completion", () => {
  const input = source();
  const plan = planPractice(input, {
    ...intent,
    scope: {
      kind: "RANGE",
      startGroupId: input.artifact.moments[1].groupId,
      endGroupId: input.artifact.moments[1].groupId,
    },
  });
  const scope = vi.spyOn(scopeContract, "resolvePracticeScope");
  const tempo = vi.spyOn(tempoContract, "resolvePracticeTempoPlan");
  const resources = vi.spyOn(resourceContract, "planPracticeResources");
  const runtime = new StepPracticeSession({ plan, clock: new ManualClock() });
  expect(runtime.currentStepIndex).toBe(plan.scope.startIndex);
  expect(runtime.snapshot().plan.scope).toBe(plan.scope);
  expect(runtime.snapshot().plan.tempoPlan).toBe(plan.tempoPlan);
  expect(runtime.snapshot().plan.source.sourceId).toBe(plan.source.sourceId);
  expect(runtime.snapshot().plan).toBe(plan);
  runtime.skip();
  expect(runtime.snapshot().completionReason).toBe("SCOPE_COMPLETED");
  expect(scope).not.toHaveBeenCalled();
  expect(tempo).not.toHaveBeenCalled();
  expect(resources).not.toHaveBeenCalled();
});
it("Continuous clock, evaluator, snapshot and natural Result consume executed resolved truth", () => {
  const resolveScope = vi.spyOn(scopeContract, "resolvePracticeScope"),
    resolveTempo = vi.spyOn(tempoContract, "resolvePracticeTempoPlan");
  const resolveResources = vi.spyOn(resourceContract, "planPracticeResources");
  const resolveCountIn = vi.spyOn(countInContract, "countInContractAt");
  const input = source(),
    plan = planPractice(input, {
      ...intent,
      mode: "CONTINUOUS_PLAY",
      scope: {
        kind: "RANGE",
        startGroupId: input.artifact.moments[1].groupId,
        endGroupId: input.artifact.moments[2].groupId,
      },
      tempoSelection: { mode: "CUSTOM_FIXED_BPM", bpm: 100 },
    });
  const clock = new ManualClock();
  const session = new ContinuousPracticeSession({
    plan,
    clock,
    createClockEvidence: (id) => new ContinuousMidiEvidence(id),
  });
  expect(session.snapshotSession().plan).toBe(plan);
  expect(session.start()).toMatchObject({
    scopeStartTick: plan.scope.startTick,
    scopeTerminalTick: plan.scope.terminalTick,
  });
  expect(Reflect.get(session.clock, "timeline").plan).toBe(plan.tempoPlan);
  expect(session.snapshotSession().plan.scope).toBe(plan.scope);
  expect(session.snapshotSession().plan.tempoPlan).toBe(plan.tempoPlan);
  expect(session.snapshotSession().plan.source.sourceId).toBe(
    plan.source.sourceId,
  );
  clock.advance(
    session.clock.scopeDurationMs() + session.snapshot().countInTotalMs + 1000,
  );
  session.advanceToNow();
  const completion = createNaturalContinuousCompletion({
    session: session.snapshotSession(),
    evaluation: session.completedEvaluation(),
    evidenceProvenance: midiEvidenceProvenance(
      CONTINUOUS_MIDI_EVIDENCE_POLICY_ID,
    ),
    recording: { status: "NOT_RECORDED" },
    completedAt: "2026-10-30T00:00:00.000Z",
  });
  expect(completion.result.scope).toEqual(plan.scope);
  expect(completion.result.tempoPlan).toEqual(plan.tempoPlan);
  expect(completion.result.schemaVersion).toBe(8);
  expect(completion.result.sourceId).toBe(plan.source.sourceId);
  expect(completion.result.evaluation.status).toBe("COMPLETE");
  if (completion.result.evaluation.status === "COMPLETE") {
    expect(
      completion.result.evaluation.assignment.groups.map(
        (group) => group.groupId,
      ),
    ).toEqual(
      plan.source.artifact.moments
        .slice(plan.scope.startIndex, plan.scope.endIndex + 1)
        .map((group) => group.groupId),
    );
  }
  expect(resolveScope).toHaveBeenCalledOnce();
  expect(resolveTempo).toHaveBeenCalledOnce();
  expect(resolveResources).toHaveBeenCalledOnce();
  expect(resolveCountIn).toHaveBeenCalledOnce();
});
it("mode-specific session boundaries require their matching resolved plans", () => {
  const step = planPractice(source(), intent);
  const continuous = planPractice(source(), {
    ...intent,
    mode: "CONTINUOUS_PLAY",
  });
  const options = { clock: new ManualClock() };
  if (false) {
    // @ts-expect-error Continuous execution cannot receive a STEP plan.
    new ContinuousPracticeSession({ ...options, plan: step });
    // @ts-expect-error STEP execution cannot receive a Continuous plan.
    new StepPracticeSession({ ...options, plan: continuous });
  }
  expect(step.mode).toBe("STEP_BY_STEP");
  expect(continuous.mode).toBe("CONTINUOUS_PLAY");
});
