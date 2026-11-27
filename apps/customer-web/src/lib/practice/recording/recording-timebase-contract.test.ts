import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertRecordingTimebase } from "./generated/recording-timebase";

const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../contracts/practice/recording-timebase.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const cases = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../contracts/practice/recording-timebase-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { name: string; valid: boolean; value: unknown }[];
const valid = () =>
  structuredClone(cases.find((item) => item.name === "single")!.value) as {
    nominalMediaDurationUs: number;
    activeSegments: Record<string, unknown>[];
  };

describe("generated RecordingTimebase boundary", () => {
  it.each(cases)("validates conformance: $name", ({ value, valid }) => {
    if (!valid) {
      expect(() => assertRecordingTimebase(value)).toThrow();
      return;
    }
    const before = JSON.stringify(value);
    assertRecordingTimebase(value);
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.isFrozen(value)).toBe(false);
  });
  it.each([null, [], true, "object", {}, { activeSegments: [] }])(
    "rejects non-timebase structure %s",
    (value) => {
      expect(() => assertRecordingTimebase(value)).toThrow();
    },
  );
  it("requires exact root and segment field sets from the schema", () => {
    for (const key of schema.required) {
      const value = valid() as Record<string, unknown>;
      delete value[key];
      expect(() => assertRecordingTimebase(value)).toThrow();
    }
    for (const key of schema.$defs.RecordingActiveSegment.required) {
      const value = valid();
      delete value.activeSegments[0][key];
      expect(() => assertRecordingTimebase(value)).toThrow();
    }
    expect(() => assertRecordingTimebase({ ...valid(), extra: 1 })).toThrow();
    const segmentExtra = valid();
    segmentExtra.activeSegments[0].extra = 1;
    expect(() => assertRecordingTimebase(segmentExtra)).toThrow();
    const arraySegment = valid();
    arraySegment.activeSegments = [[] as unknown as Record<string, unknown>];
    expect(() => assertRecordingTimebase(arraySegment)).toThrow();
    expect(() =>
      assertRecordingTimebase({ ...valid(), activeSegments: [] }),
    ).toThrow();
    expect(() =>
      assertRecordingTimebase({
        ...valid(),
        nominalMediaDurationUs: 0,
      }),
    ).toThrow();
  });
  it.each([
    true,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid primitive coordinate %s", (coordinate) => {
    expect(() =>
      assertRecordingTimebase({
        ...valid(),
        nominalMediaDurationUs: coordinate,
      }),
    ).toThrow();
    for (const key of schema.$defs.RecordingActiveSegment.required) {
      const value = valid();
      value.activeSegments[0][key] = coordinate;
      expect(() => assertRecordingTimebase(value)).toThrow();
    }
  });
  it("admits the declared safe-integer maximum with exact segment rate", () => {
    const end = schema.$defs.RecordingCoordinate.maximum;
    expect(() =>
      assertRecordingTimebase({
        nominalMediaDurationUs: end,
        activeSegments: [
          {
            performanceStartUs: 0,
            performanceEndUs: end,
            mediaStartUs: 0,
            mediaEndUs: end,
          },
        ],
      }),
    ).not.toThrow();
  });
});
