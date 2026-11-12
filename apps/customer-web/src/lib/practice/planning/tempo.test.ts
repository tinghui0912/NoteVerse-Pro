import { DEFAULT_SCORE_TEMPO_BPM } from "@/lib/score/tempo-policy";
import canonical from "../__fixtures__/canonical-practice-score-artifact.json";
import { decodePracticeScoreArtifact } from "@/lib/practice/contracts/generated/score-artifact";
import { leadingRestArtifact } from "@/lib/practice/__fixtures__/leading-rest-artifact";
import { PracticeScoreArtifact } from "@/lib/practice/score/artifact";
import {
  effectiveScoreTempoAtTick,
  hasExplicitScoreTempo,
  hasScoreTempoChanges,
  initialScoreTempoBpm,
  isCustomTempoValid,
  PracticeTempoTimeline,
  ticksToMs,
  resolvePracticeTempoPlan,
} from "@/lib/practice/planning/tempo";
import { describe, expect, it } from "vitest";

function createMockArtifact(
  scoreTempoSegments: { startTick: number; bpm: number }[],
): PracticeScoreArtifact {
  return {
    schemaVersion: 1,
    ticksPerQuarter: 1,

    artifactId: "test-artifact",
    notes: [],
    events: [],
    moments: [],
    meterSegments: [],
    scoreTempoSegments,

    scoreEndTick: 16,
  };
}

describe("practice-tempo", () => {
  describe("custom tempo admission", () => {
    it("keeps the Score default at 80 BPM", () => {
      expect(DEFAULT_SCORE_TEMPO_BPM).toBe(80);
    });
    it.each([
      20,
      20.5,
      39.99,
      80.5,
      240.01,
      300.25,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
    ])("admits positive finite BPM %s exactly", (bpm) => {
      expect(isCustomTempoValid(bpm)).toBe(true);
      const selection = { mode: "CUSTOM_FIXED_BPM" as const, bpm };
      const plan = resolvePracticeTempoPlan(createMockArtifact([]), selection);
      expect(plan.selection).toBe(selection);
      expect(plan.segments).toEqual([{ startTick: 0, bpm, source: "CUSTOM" }]);
    });
    it.each([0, -1, NaN, Infinity, -Infinity])(
      "rejects invalid custom BPM %s",
      (bpm) => {
        expect(isCustomTempoValid(bpm)).toBe(false);
        expect(() =>
          resolvePracticeTempoPlan(createMockArtifact([]), {
            mode: "CUSTOM_FIXED_BPM",
            bpm,
          }),
        ).toThrow();
      },
    );
  });

  describe("resolvePracticeTempoPlan", () => {
    it("resolves SCORE mode with empty scoreTempoSegments to PRODUCT_DEFAULT 80 BPM", () => {
      const artifact = createMockArtifact([]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: "SCORE" });

      expect(plan).toEqual({
        selection: { mode: "SCORE" },
        segments: [{ startTick: 0, bpm: 80, source: "PRODUCT_DEFAULT" }],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(false);
      expect(initialScoreTempoBpm(artifact)).toBe(80);
      expect(hasScoreTempoChanges(artifact)).toBe(false);
    });

    it("resolves SCORE mode with explicit tempo starting at tick 0 to MUSICXML", () => {
      const artifact = createMockArtifact([
        { startTick: 0, bpm: 112 },
        { startTick: 8, bpm: 96 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: "SCORE" });

      expect(plan).toEqual({
        selection: { mode: "SCORE" },
        segments: [
          { startTick: 0, bpm: 112, source: "MUSICXML" },
          { startTick: 8, bpm: 96, source: "MUSICXML" },
        ],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(true);
      expect(initialScoreTempoBpm(artifact)).toBe(112);
      expect(hasScoreTempoChanges(artifact)).toBe(true);
    });

    it("resolves SCORE mode with first tempo starting at tick > 0 by prepending default 80 BPM at tick 0", () => {
      const artifact = createMockArtifact([{ startTick: 4, bpm: 100 }]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: "SCORE" });

      expect(plan).toEqual({
        selection: { mode: "SCORE" },
        segments: [
          { startTick: 0, bpm: 80, source: "PRODUCT_DEFAULT" },
          { startTick: 4, bpm: 100, source: "MUSICXML" },
        ],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(true);
      expect(initialScoreTempoBpm(artifact)).toBe(80);
      expect(hasScoreTempoChanges(artifact)).toBe(false);
    });

    it("resolves CUSTOM_FIXED_BPM mode across entire practice score", () => {
      const artifact = createMockArtifact([
        { startTick: 0, bpm: 140 },
        { startTick: 8, bpm: 120 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, {
        mode: "CUSTOM_FIXED_BPM",
        bpm: 60,
      });

      expect(plan).toEqual({
        selection: { mode: "CUSTOM_FIXED_BPM", bpm: 60 },
        segments: [{ startTick: 0, bpm: 60, source: "CUSTOM" }],
      });
    });
  });

  describe("effectiveScoreTempoAtTick", () => {
    it("returns default 80 with PRODUCT_DEFAULT source if artifact has no tempo segments", () => {
      const artifact = createMockArtifact([]);
      const eff = effectiveScoreTempoAtTick(artifact, 0);
      expect(eff).toEqual({
        bpm: 80,
        source: "PRODUCT_DEFAULT",
        hasSubsequentScoreTempoChanges: false,
        isDefault: true,
        hasSubsequentChanges: false,
      });
    });

    it("returns default 80 with PRODUCT_DEFAULT source and hasSubsequentScoreTempoChanges if first explicit tempo is at tick > 0", () => {
      const artifact = createMockArtifact([{ startTick: 4, bpm: 120 }]);
      const eff = effectiveScoreTempoAtTick(artifact, 0);
      expect(eff).toEqual({
        bpm: 80,
        source: "PRODUCT_DEFAULT",
        hasSubsequentScoreTempoChanges: true,
        nextScoreTempoTick: 4,
        isDefault: true,
        hasSubsequentChanges: true,
        explicitStartTick: 4,
      });
    });

    it("returns active tempo with MUSICXML source when scopeStartTick reaches explicit tempo", () => {
      const artifact = createMockArtifact([{ startTick: 4, bpm: 120 }]);
      const eff = effectiveScoreTempoAtTick(artifact, 4);
      expect(eff).toEqual({
        bpm: 120,
        source: "MUSICXML",
        hasSubsequentScoreTempoChanges: false,
        nextScoreTempoTick: undefined,
        isDefault: false,
        hasSubsequentChanges: false,
        explicitStartTick: 4,
      });
    });

    it("returns active tempo at scopeStartTick when multiple tempo segments exist", () => {
      const artifact = createMockArtifact([
        { startTick: 0, bpm: 100 },
        { startTick: 8, bpm: 120 },
        { startTick: 16, bpm: 90 },
      ]);
      const effAt0 = effectiveScoreTempoAtTick(artifact, 0);
      expect(effAt0.bpm).toBe(100);
      expect(effAt0.source).toBe("MUSICXML");
      expect(effAt0.hasSubsequentScoreTempoChanges).toBe(true);
      expect(effAt0.nextScoreTempoTick).toBe(8);

      const effAt10 = effectiveScoreTempoAtTick(artifact, 10);
      expect(effAt10.bpm).toBe(120);
      expect(effAt10.source).toBe("MUSICXML");
      expect(effAt10.hasSubsequentScoreTempoChanges).toBe(true);
      expect(effAt10.nextScoreTempoTick).toBe(16);

      const effAt20 = effectiveScoreTempoAtTick(artifact, 20);
      expect(effAt20.bpm).toBe(90);
      expect(effAt20.source).toBe("MUSICXML");
      expect(effAt20.hasSubsequentScoreTempoChanges).toBe(false);
      expect(effAt20.nextScoreTempoTick).toBeUndefined();
    });
  });

  describe("PracticeTempoTimeline", () => {
    it("calculates tickToTimeMs, timeMsToTick, and bpmAtTick accurately across tempo changes", () => {
      const plan = resolvePracticeTempoPlan(
        createMockArtifact([
          { startTick: 0, bpm: 120 }, // 1 tick = 500ms
          { startTick: 4, bpm: 60 }, // 1 tick = 1000ms
        ]),
        { mode: "SCORE" },
      );
      const timeline = new PracticeTempoTimeline(plan, 8, 1);

      expect(timeline.bpmAtTick(0)).toBe(120);
      expect(timeline.bpmAtTick(2)).toBe(120);
      expect(timeline.bpmAtTick(4)).toBe(60);
      expect(timeline.bpmAtTick(6)).toBe(60);

      // Beat to time
      expect(timeline.tickToTimeMs(0)).toBe(0);
      expect(timeline.tickToTimeMs(2)).toBe(1000);
      expect(timeline.tickToTimeMs(4)).toBe(2000);
      expect(timeline.tickToTimeMs(5)).toBe(3000);
      expect(timeline.tickToTimeMs(8)).toBe(6000);

      // Time to tick
      expect(timeline.timeMsToTick(0)).toBe(0);
      expect(timeline.timeMsToTick(1000)).toBe(2);
      expect(timeline.timeMsToTick(2000)).toBe(4);
      expect(timeline.timeMsToTick(3000)).toBe(5);
      expect(timeline.timeMsToTick(6000)).toBe(8);

      expect(timeline.durationMs).toBe(6000);
    });
  });
});

it("resolves score tempo at the first playable onset after a leading rest", () => {
  // Effective tempo at start of practice (tick 2.0)
  const tempoInfo = effectiveScoreTempoAtTick(
    leadingRestArtifact,
    leadingRestArtifact.moments[0].onsetTick,
  );
  expect(tempoInfo.bpm).toBe(100);
  expect(tempoInfo.source).toBe("MUSICXML");
});

it.each([
  { scoreTempoSegments: [] },
  { scoreTempoSegments: [{ startTick: 3, bpm: 100 }] },
])(
  "admitted explicit meter supports optional and delayed score tempo",
  ({ scoreTempoSegments }) => {
    const artifact = decodePracticeScoreArtifact({
      ...structuredClone(canonical),
      scoreTempoSegments,
    });
    const plan = resolvePracticeTempoPlan(artifact, { mode: "SCORE" });
    expect(plan.segments[0]).toEqual({
      startTick: 0,
      bpm: 80,
      source: "PRODUCT_DEFAULT",
    });
    expect(plan.segments.slice(1)).toEqual(
      scoreTempoSegments.map((t) => ({ ...t, source: "MUSICXML" })),
    );
    const timeline = new PracticeTempoTimeline(
      plan,
      artifact.scoreEndTick,
      artifact.ticksPerQuarter,
    );
    expect(timeline.bpmAtTick(0)).toBe(80);
    if (scoreTempoSegments.length) expect(timeline.bpmAtTick(3)).toBe(100);
  },
);

it("admits positive tempo independently of contextual runtime duration representability", () => {
  const selection = {
    mode: "CUSTOM_FIXED_BPM" as const,
    bpm: Number.MIN_VALUE,
  };
  const plan = resolvePracticeTempoPlan(createMockArtifact([]), selection);
  expect(plan.segments[0].bpm).toBe(selection.bpm);
  expect(ticksToMs(0, selection.bpm, 1)).toBe(0);
  expect(() => ticksToMs(1, selection.bpm, 1)).toThrow(
    "Unrepresentable Practice runtime duration",
  );
  expect(() => new PracticeTempoTimeline(plan, 1, 1)).toThrow(
    "Unrepresentable Practice runtime duration",
  );
  const largeScore = Number.MAX_SAFE_INTEGER;
  const slowPlan = resolvePracticeTempoPlan(createMockArtifact([]), {
    mode: "CUSTOM_FIXED_BPM",
    bpm: 1e-300,
  });
  expect(() => new PracticeTempoTimeline(slowPlan, largeScore, 1)).toThrow(
    "Unrepresentable Practice runtime duration",
  );
  expect(new PracticeTempoTimeline(slowPlan, 1, 1).durationMs).toBe(
    60000 / 1e-300,
  );
});
