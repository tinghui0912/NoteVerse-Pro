import { expect, it } from "vitest";
import { recordedPerformanceFixture } from "@/lib/practice/__fixtures__/recorded-performance";
import { compositeVideoInput } from "./input";
it.each(["AUDIO", "VIDEO"] as const)(
  "admits %s without cloning execution or retaining recording",
  (kind) => {
    const base = recordedPerformanceFixture();
    const performance = {
      ...base,
      recording: {
        ...base.recording,
        kind,
        mimeType: kind === "AUDIO" ? "audio/webm" : "video/webm",
      },
    };
    const input = compositeVideoInput(performance, "<canonical-score />");
    expect(input.recordedPerformance).toBe(performance);
    expect(Object.keys(input).sort()).toEqual([
      "musicXml",
      "recordedPerformance",
    ]);
    expect(Object.isFrozen(input)).toBe(true);
  },
);
it.each([
  "notation",
  "empty recording",
  "timebase",
  "binding",
  "artifact",
] as const)("rejects invalid %s", (field) => {
  const base = recordedPerformanceFixture();
  const performance =
    field === "empty recording"
      ? {
          ...base,
          recording: {
            ...base.recording,
            media: { ...base.recording.media, blob: new Blob([]), byteSize: 0 },
          },
        }
      : field === "timebase"
        ? {
            ...base,
            recording: {
              ...base.recording,
              timebase: { activeSegments: [], nominalMediaDurationUs: 0 },
            },
          }
        : field === "binding"
          ? {
              ...base,
              executed: {
                ...base.executed,
                bundle: {
                  ...base.executed.bundle,
                  binding: { ...base.executed.bundle.binding, bundleId: "" },
                },
              },
            }
          : field === "artifact"
            ? {
                ...base,
                executed: {
                  ...base.executed,
                  bundle: {
                    ...base.executed.bundle,
                    artifact: { ...base.executed.bundle.artifact, notes: [] },
                  },
                },
              }
            : base;
  expect(() =>
    compositeVideoInput(performance, field === "notation" ? " " : "<score />"),
  ).toThrow();
});
