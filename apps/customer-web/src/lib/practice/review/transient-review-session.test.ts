import {
  recordingSinkFixture,
  ownedMediaFixture,
} from "@/lib/practice/__fixtures__/recording-sink";
import { expect, it } from "vitest";
import type { PracticeScoreArtifact } from "@/lib/practice/score/artifact";
import fixture from "@/lib/practice/__fixtures__/canonical-practice-score-artifact.json";
import { canonicalContinuousResultFixture } from "@/lib/practice/__fixtures__/continuous-result";
import { createPerformanceRecording } from "@/lib/practice/recording/recording-artifact";
import {
  releaseTransientReviewSession,
  createTransientReviewSession,
} from "./transient-review-session";
const artifact = fixture as PracticeScoreArtifact;
const source = {
  ...canonicalContinuousResultFixture().session.plan.source,
  musicXml: "<score />",
};
it("hands off canonical references without copying artifact, result or Blob bytes", () => {
  const result = canonicalContinuousResultFixture(),
    blob = new Blob(["video"], { type: "video/webm" });
  const recording = createPerformanceRecording({
    status: "READY",
    kind: "VIDEO",
    media: ownedMediaFixture(blob),
    mimeType: "video/webm",
    durationMs: 10000,
    timebase: {
      nominalMediaDurationMs: 10000,
      activeSegments: [
        {
          perfStartMs: 0,
          perfEndMs: 10000,
          mediaStartMs: 0,
          mediaEndMs: 10000,
        },
      ],
    },
  });
  const session = createTransientReviewSession({ result, recording }, source);
  expect(session.result).toBe(result);
  expect(session.recording).not.toBe(recording);
  expect(session.result.session.plan.source.artifact).toBe(artifact);
  expect(
    session.recording.status === "READY" && session.recording.media.blob,
  ).toBe(blob);
  expect(Object.isFrozen(session)).toBe(true);
});
it.each(["sourceId", "scoreId", "revisionId", "artifactId"] as const)(
  "rejects %s mismatch before Review ownership begins",
  (field) => {
    const result = canonicalContinuousResultFixture();
    const mismatched =
      field === "sourceId"
        ? { ...source, sourceId: "wrong" }
        : { ...source, artifact: { ...source.artifact, [field]: "wrong" } };
    expect(() =>
      createTransientReviewSession(
        { result, recording: { status: "NOT_RECORDED" } },
        mismatched,
      ),
    ).toThrow();
  },
);
it.each(["", "   "])("requires admitted notation: %j", (musicXml) => {
  expect(() =>
    createTransientReviewSession(
      {
        result: canonicalContinuousResultFixture(),
        recording: { status: "NOT_RECORDED" },
      },
      { ...source, musicXml },
    ),
  ).toThrow();
});
it("validates recording before accepting the typed completion", () => {
  const completion = {
    result: canonicalContinuousResultFixture(),
    recording: { status: "NOT_RECORDED" as const },
  };
  expect(() =>
    createTransientReviewSession(
      { ...completion, recording: { status: "READY" } as never },
      source,
    ),
  ).toThrow();
});

it("retains before controller retirement, and final Review release removes media exactly once", async () => {
  const f = recordingSinkFixture();
  await f.sink.append(new Blob(["raw"]));
  const media = await f.sink.seal("video/webm");
  const recording = createPerformanceRecording({
    status: "READY",
    kind: "VIDEO",
    media,
    mimeType: "video/webm",
    durationMs: 10000,
    timebase: {
      nominalMediaDurationMs: 10000,
      activeSegments: [
        {
          perfStartMs: 0,
          perfEndMs: 10000,
          mediaStartMs: 0,
          mediaEndMs: 10000,
        },
      ],
    },
  });
  const result = canonicalContinuousResultFixture();
  expect(() =>
    createTransientReviewSession(
      { result, recording },
      { ...source, sourceId: "wrong" },
    ),
  ).toThrow();
  const session = createTransientReviewSession({ result, recording }, source);
  if (recording.status !== "READY") throw new Error("Expected capture");
  await recording.media.release();
  expect(f.exists()).toBe(true);
  expect(
    session.recording.status === "READY" &&
      (await session.recording.media.blob.text()),
  ).toBe("raw");
  await releaseTransientReviewSession(session);
  await releaseTransientReviewSession(session);
  expect(f.exists()).toBe(false);
  expect(f.remove).toHaveBeenCalledOnce();
});

it("invalid handoff takes no reference and controller retirement deletes the media", async () => {
  const f = recordingSinkFixture();
  await f.sink.append(new Blob(["raw"]));
  const media = await f.sink.seal("video/webm");
  const recording = createPerformanceRecording({
    status: "READY",
    kind: "VIDEO",
    media,
    mimeType: "video/webm",
    durationMs: 10000,
    timebase: {
      nominalMediaDurationMs: 10000,
      activeSegments: [
        {
          perfStartMs: 0,
          perfEndMs: 10000,
          mediaStartMs: 0,
          mediaEndMs: 10000,
        },
      ],
    },
  });
  expect(() =>
    createTransientReviewSession(
      { result: canonicalContinuousResultFixture(), recording },
      { ...source, musicXml: "" },
    ),
  ).toThrow();
  await media.release();
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.exists()).toBe(false);
});

it("requires the exact admitted artifact even when stable identity fields agree", () => {
  const result = canonicalContinuousResultFixture();
  expect(() =>
    createTransientReviewSession(
      { result, recording: { status: "NOT_RECORDED" } },
      { ...source, artifact: { ...source.artifact } },
    ),
  ).toThrow("source identity");
});
