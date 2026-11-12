import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertRecordingTimebaseStructure } from "./generated/recording-timebase-contract";
import { assertRecordingTimebase } from "./recording-timebase";

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

describe("generated RecordingTimebase structural boundary", () => {
  it.each(cases.filter((item) => item.valid))(
    "admits canonical structure: $name",
    ({ value }) => {
      const before = JSON.stringify(value);
      assertRecordingTimebaseStructure(value);
      expect(JSON.stringify(value)).toBe(before);
      expect(Object.isFrozen(value)).toBe(false);
    },
  );
  it.each([null, [], true, "object", {}, { activeSegments: [] }])(
    "rejects non-timebase structure %s",
    (value) => {
      expect(() => assertRecordingTimebaseStructure(value)).toThrow();
    },
  );
  it("requires exact root and segment field sets from the schema", () => {
    for (const key of schema.required) {
      const value = valid() as Record<string, unknown>;
      delete value[key];
      expect(() => assertRecordingTimebaseStructure(value)).toThrow();
    }
    for (const key of schema.$defs.RecordingActiveSegment.required) {
      const value = valid();
      delete value.activeSegments[0][key];
      expect(() => assertRecordingTimebaseStructure(value)).toThrow();
    }
    expect(() =>
      assertRecordingTimebaseStructure({ ...valid(), extra: 1 }),
    ).toThrow();
    const segmentExtra = valid();
    segmentExtra.activeSegments[0].extra = 1;
    expect(() => assertRecordingTimebaseStructure(segmentExtra)).toThrow();
    const arraySegment = valid();
    arraySegment.activeSegments = [[] as unknown as Record<string, unknown>];
    expect(() => assertRecordingTimebaseStructure(arraySegment)).toThrow();
    expect(() =>
      assertRecordingTimebaseStructure({ ...valid(), activeSegments: [] }),
    ).toThrow();
    expect(() =>
      assertRecordingTimebaseStructure({
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
      assertRecordingTimebaseStructure({
        ...valid(),
        nominalMediaDurationUs: coordinate,
      }),
    ).toThrow();
    for (const key of schema.$defs.RecordingActiveSegment.required) {
      const value = valid();
      value.activeSegments[0][key] = coordinate;
      expect(() => assertRecordingTimebaseStructure(value)).toThrow();
    }
  });
  it("uses declared coordinate minima and maximum without enforcing cross-field math", () => {
    const value = valid();
    for (const [key, descriptor] of Object.entries(
      schema.$defs.RecordingActiveSegment.properties,
    )) {
      const minimum =
        (descriptor as { minimum?: number }).minimum ??
        schema.$defs.RecordingCoordinate.minimum;
      value.activeSegments[0][key] = minimum;
      if (minimum > 0) {
        const invalid = valid();
        invalid.activeSegments[0][key] = minimum - 1;
        expect(() => assertRecordingTimebaseStructure(invalid)).toThrow();
      }
    }
    value.nominalMediaDurationUs = schema.$defs.RecordingCoordinate.maximum;
    expect(() => assertRecordingTimebaseStructure(value)).not.toThrow();
    expect(() => assertRecordingTimebase(value)).toThrow();
  });
  it.each(["rate_mismatch_one_us", "performance_overlap", "media_gap_one_us"])(
    "leaves semantic rejection to the runtime: %s",
    (name) => {
      const value = cases.find((item) => item.name === name)!.value;
      expect(() => assertRecordingTimebaseStructure(value)).not.toThrow();
      expect(() => assertRecordingTimebase(value)).toThrow();
    },
  );
});
