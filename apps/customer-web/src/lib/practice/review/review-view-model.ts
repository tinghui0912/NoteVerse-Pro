import type { ContinuousPerformanceResult } from "@/lib/practice/result/continuous-performance-result";

export function reviewViewModel(result: ContinuousPerformanceResult) {
  const totalSeconds = Math.max(
    0,
    Math.floor(result.session.performance.activeElapsedMs / 1000),
  );
  return {
    durationText: `${Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`,
    tempo:
      result.session.plan.tempoPlan.selection.mode === "CUSTOM_FIXED_BPM"
        ? {
            kind: "CUSTOM_FIXED_BPM" as const,
            bpm: result.session.plan.tempoPlan.selection.bpm,
          }
        : { kind: "SCORE" as const },
    scope: {
      label:
        result.session.plan.scope.kind === "RANGE"
          ? ("scopeSection" as const)
          : ("scopeFull" as const),
      startTick: result.session.plan.scope.startTick,
      terminalTick: result.session.plan.scope.terminalTick,
    },
    inputSourceLabel:
      result.session.plan.resources.input.kind === "MICROPHONE"
        ? ("inputSourceMic" as const)
        : ("inputSourceMidi" as const),
  };
}
