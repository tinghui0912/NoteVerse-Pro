import { microsecondsToMilliseconds } from "@/lib/practice/recording/recording-timebase";
import { openCompositeVideoOutputMedia } from "./output-media";
import {
  releaseLocalMediaAsset,
  type LocalMediaAsset,
} from "@/lib/practice/media/local-media-asset";
import { resolveCompositeVideoPlaybackPosition } from "./playback-position";
import { renderCompositeVideoFrameAtTime } from "./frame-renderer";
import {
  getCompositeVideoLayout,
  type CompositeVideoConfig,
} from "./templates";
import {
  findStablePageNumber,
  prefetchEventScoreImage,
  prepareCompositeScoreModel,
  resolveExportPlaybackGeometry,
  type CompositeScoreModel,
} from "./score-model";
import { compositeVideoInput, type CompositeVideoInput } from "./input";
import {
  openCompositeMediaDecoder,
  type CompositeMediaDecoder,
} from "./media-decoder";
import type { RecordedPerformance } from "@/lib/practice/recording/recorded-performance";

const EXPORT_FPS = 30;
const COMPOSITE_VIDEO_CHUNK_TIMESLICE_MS = 1000;

const COMPOSITE_VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export type CompositeVideoReadiness =
  | { ok: true; mimeType: string }
  | { ok: false; reason: CompositeVideoBlockReason };

type CompositeVideoBlockReason =
  | "input_unavailable"
  | "media_recorder_unsupported"
  | "canvas_capture_unsupported";

type CompositeVideoProgress = {
  mediaTimeMs: number;
  durationMs: number;
  ratio: number;
};

export type CompositeVideoResult = Readonly<{
  media: LocalMediaAsset;
  mimeType: string;
  durationMs: number;
}>;

export type CompositeVideoOptions = {
  input: CompositeVideoInput;
  signal?: AbortSignal;
  onProgress?: (progress: CompositeVideoProgress) => void;
  config?: CompositeVideoConfig;
};
type FrameRenderState = {
  scoreModel: CompositeScoreModel;
  stagingCanvas: HTMLCanvasElement;
  stagingCtx: CanvasRenderingContext2D;
  sourceFrame: HTMLCanvasElement | null;
};

export function selectSupportedCompositeVideoMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return "video/webm";
  }
  return (
    COMPOSITE_VIDEO_MIME_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    ) ?? null
  );
}

export function getCompositeVideoReadiness(
  input: CompositeVideoInput | null,
): CompositeVideoReadiness {
  try {
    if (!input) return { ok: false, reason: "input_unavailable" };
    compositeVideoInput(input.recordedPerformance, input.musicXml);
  } catch {
    return { ok: false, reason: "input_unavailable" };
  }
  const mimeType = selectSupportedCompositeVideoMimeType();
  if (!mimeType) return { ok: false, reason: "media_recorder_unsupported" };
  if (!canCaptureCanvasStream())
    return { ok: false, reason: "canvas_capture_unsupported" };
  return { ok: true, mimeType };
}

export function composeCompositeVideoOutputStream(
  canvasStream: MediaStream,
  audioStream: MediaStream,
): MediaStream {
  return new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ]);
}

export async function exportCompositeVideo({
  input,
  signal,
  onProgress,
  config = { orientation: "landscape" },
}: CompositeVideoOptions): Promise<CompositeVideoResult> {
  const checkCancellation = () => {
    if (signal?.aborted)
      throw new DOMException("Export cancelled", "AbortError");
  };
  checkCancellation();
  const readiness = getCompositeVideoReadiness(input);
  if (!readiness.ok)
    throw new Error(`composite_video_unavailable:${readiness.reason}`);
  const { recordedPerformance } = input;
  const layout = getCompositeVideoLayout(
    config,
    recordedPerformance.recording.kind,
  );

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("composite_video_unavailable:canvas_context");
  }

  let decoder: CompositeMediaDecoder | null = null;
  let model: CompositeScoreModel | null = null;
  let audioContext: AudioContext | null = null;
  let canvasStream: MediaStream | null = null;
  let outputStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let frameId: number | null = null;
  let outputFile: Awaited<
    ReturnType<typeof openCompositeVideoOutputMedia>
  > | null = null;
  let outputMedia: LocalMediaAsset | null = null;
  let abortingOutput: Promise<void> | null = null;
  let detachAbort: (() => void) | null = null;
  let completedResult: CompositeVideoResult | null = null;
  let outputFailure: unknown;
  const abortOutput = () =>
    (abortingOutput ??= outputFile?.abort() ?? Promise.resolve());
  const stopOutput = () => {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } finally {
      canvasStream?.getTracks().forEach((track) => track.stop());
      outputStream?.getTracks().forEach((track) => track.stop());
    }
  };

  try {
    try {
      decoder = await openCompositeMediaDecoder(input, signal);
      const mediaElement = decoder.element;
      model = await prepareCompositeScoreModel({
        musicXml: input.musicXml,
        artifact: recordedPerformance.executed.bundle.artifact,
        signal,
      });
      const stagingCanvas = document.createElement("canvas");
      stagingCanvas.width = layout.width;
      stagingCanvas.height = layout.height;
      const stagingCtx = stagingCanvas.getContext("2d");
      if (!stagingCtx) {
        throw new Error("composite_video_unavailable:canvas_context");
      }
      const frameState: FrameRenderState = {
        scoreModel: model,
        stagingCanvas,
        stagingCtx,
        sourceFrame: decoder.video ? document.createElement("canvas") : null,
      };

      await drawCompositeVideoFrame({
        ctx,
        mediaElement,
        recordedPerformance,

        frameState,
        config,
      });
      await prefetchUpcomingEventImage({
        mediaTimeMs: Math.max(0, mediaElement.currentTime * 1000) + 400,
        mediaElement,
        recordedPerformance,

        model,
      });

      checkCancellation();
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("composite_video_failed:audio_context_unavailable");
      }
      audioContext = new AudioContextCtor();
      const source = audioContext.createMediaElementSource(mediaElement);
      const audioDestination = audioContext.createMediaStreamDestination();
      source.connect(audioDestination);
      if (audioDestination.stream.getAudioTracks().length === 0) {
        throw new Error("composite_video_failed:audio_track_missing");
      }

      canvasStream = canvas.captureStream(EXPORT_FPS);
      outputStream = composeCompositeVideoOutputStream(
        canvasStream,
        audioDestination.stream,
      );
      if (outputStream.getAudioTracks().length === 0) {
        throw new Error("composite_video_failed:audio_track_missing");
      }

      outputFile = await openCompositeVideoOutputMedia(signal);
      checkCancellation();
      recorder = new MediaRecorder(outputStream, {
        mimeType: readiness.mimeType,
      });
      let phase: "ENCODING" | "DRAINING" | "SEALED" | "FAILED" = "ENCODING";
      const acceptingFrames = () => phase === "ENCODING" && !signal?.aborted;
      let writes: Promise<void> = Promise.resolve();
      let sealing: Promise<void> | null = null;
      let failExport!: (error: unknown) => void;
      const result = new Promise<CompositeVideoResult>((resolve, reject) => {
        failExport = (error) => {
          if (phase === "FAILED") return;
          phase = "FAILED";
          outputFailure = error;
          // Fence callbacks before stop(), which can synchronously publish final events.
          try {
            stopOutput();
          } catch {
            /* Storage retirement still runs if encoder stop fails. */
          }
          const retirement = abortOutput();
          void Promise.allSettled([retirement, writes, sealing]).then(
            (outcomes) => {
              const cleanup = outcomes[0];
              reject(
                cleanup.status === "rejected"
                  ? new Error("composite_video_failed:output_cleanup", {
                      cause: cleanup.reason,
                    })
                  : error,
              );
            },
          );
        };
        recorder!.ondataavailable = (event) => {
          if (phase !== "ENCODING" || !event.data?.size) return;
          // The OPFS primitive serializes accepted appends in event order and releases
          // each chunk after its write. No complete-output chunk collection exists.
          writes = outputFile!.append(event.data).catch((cause) => {
            failExport(
              new Error("composite_video_failed:output_write", { cause }),
            );
          });
        };
        recorder!.onerror = () =>
          failExport(new Error("composite_video_failed:encoding"));
        recorder!.onstop = () => {
          if (phase !== "ENCODING") return;
          phase = "DRAINING";
          const durationMs = Math.max(0, mediaElement.currentTime * 1000);
          sealing = (async () => {
            await writes;
            if (phase !== "DRAINING") return;
            const media = await outputFile!.seal(readiness.mimeType);
            outputMedia = media;
            if (phase !== "DRAINING" || signal?.aborted) return;
            if (media.byteSize <= 0) {
              failExport(new Error("composite_video_failed:empty_output"));
              return;
            }
            phase = "SEALED";
            resolve(
              Object.freeze({
                media,
                mimeType: readiness.mimeType,
                durationMs,
              }),
            );
          })().catch(failExport);
        };
      });
      const onAbort = () =>
        failExport(new DOMException("Export cancelled", "AbortError"));
      signal?.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => signal?.removeEventListener("abort", onAbort);
      const stopRecorder = () => {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      };

      const renderLoop = async () => {
        if (!acceptingFrames()) return;
        if (mediaElement.ended) {
          try {
            await drawCompositeVideoFrame({
              ctx,
              mediaElement,
              recordedPerformance,

              frameState,
              config,
            });
          } catch (err) {
            failExport(err);
            return;
          }
          if (!acceptingFrames()) return;
          onProgress?.({
            mediaTimeMs: Math.max(0, mediaElement.currentTime * 1000),
            durationMs: Math.max(0, mediaElement.duration * 1000),
            ratio: 1,
          });
          stopRecorder();
          return;
        }

        try {
          const frameStartedAt = performance.now();
          await drawCompositeVideoFrame({
            ctx,
            mediaElement,
            recordedPerformance,

            frameState,
            config,
          });
          const frameWaitMs = performance.now() - frameStartedAt;
          if (frameWaitMs > 250) {
            failExport(
              new Error("composite_video_failed:frame_prepare_timeout"),
            );
            return;
          }
          void prefetchUpcomingEventImage({
            mediaTimeMs: Math.max(0, mediaElement.currentTime * 1000) + 400,
            mediaElement,
            recordedPerformance,

            model: frameState.scoreModel,
          }).catch(() => undefined);
        } catch (err) {
          failExport(err);
          return;
        }
        if (!acceptingFrames()) return;
        const durationMs = Number.isFinite(mediaElement.duration)
          ? Math.max(0, mediaElement.duration * 1000)
          : microsecondsToMilliseconds(
              recordedPerformance.recording.timebase.nominalMediaDurationUs,
            );
        const mediaTimeMs = Math.max(0, mediaElement.currentTime * 1000);
        onProgress?.({
          mediaTimeMs,
          durationMs,
          ratio: durationMs > 0 ? Math.min(1, mediaTimeMs / durationMs) : 0,
        });
        frameId = window.requestAnimationFrame(() => {
          void renderLoop().catch(failExport);
        });
      };

      // Observe encoder/output outcomes immediately, including while playback startup
      // is asynchronous. Startup failures enter the same single retirement path.
      void (async () => {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        recorder!.start(COMPOSITE_VIDEO_CHUNK_TIMESLICE_MS);
        await audioContext!.resume();
        if (!acceptingFrames()) return;
        await mediaElement.play();
        if (!acceptingFrames()) return;
        frameId = window.requestAnimationFrame(() => {
          void renderLoop().catch(failExport);
        });
      })().catch(failExport);
      completedResult = await result;
    } finally {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      await decoder?.dispose();
      model?.dispose();
      canvasStream?.getTracks().forEach((track) => track.stop());
      outputStream?.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);
    }
    // Publication is after asynchronous browser teardown. Cancellation during seal
    // or teardown still belongs to this operation, never to a caller.
    checkCancellation();
    if (outputFailure) throw outputFailure;
    if (!outputMedia) throw new Error("composite_video_failed:empty_output");
    if (!completedResult)
      throw new Error("composite_video_failed:empty_output");
    const exported = completedResult;
    outputMedia = null;
    outputFile = null;
    return exported;
  } finally {
    detachAbort?.();
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    if (outputMedia) await releaseLocalMediaAsset(outputMedia);
    if (outputFile) await abortOutput();
  }
}

async function prefetchUpcomingEventImage({
  mediaTimeMs,
  mediaElement,
  recordedPerformance,
  model,
}: {
  mediaTimeMs: number;
  mediaElement: HTMLMediaElement;
  recordedPerformance: RecordedPerformance;
  model: CompositeScoreModel;
}) {
  const position = resolveCompositeVideoPlaybackPosition({
    recordedPerformance,
    adapter: model.adapter,
    pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, model.pages),
    mediaTimeMs,
    actualMediaDurationMs: safeDurationMs(mediaElement),
  });
  if (!position) return;
  const page = model.pages.get(position.pageNumber);
  if (!page) return;
  const playback = resolveExportPlaybackGeometry(page, position.noteIds);
  if (!playback) return;
  await prefetchEventScoreImage(
    page,
    position.noteIds,
    playback.anchorNote.noteId,
  );
}

export async function drawCompositeVideoFrame({
  ctx,
  mediaElement,
  recordedPerformance,
  frameState,
  config = { orientation: "landscape" },
}: {
  ctx: CanvasRenderingContext2D;
  mediaElement: HTMLMediaElement;
  recordedPerformance: RecordedPerformance;
  frameState: FrameRenderState;
  config?: CompositeVideoConfig;
}): Promise<void> {
  const model = frameState.scoreModel;
  const layout = getCompositeVideoLayout(
    config,
    recordedPerformance.recording.kind,
  );
  const mediaTimeMs = Math.max(0, mediaElement.currentTime * 1000);
  const sourceFrame = frameState.sourceFrame;
  if (recordedPerformance.recording.kind === "VIDEO") {
    if (
      !sourceFrame ||
      !(mediaElement instanceof HTMLVideoElement) ||
      !mediaElement.videoWidth ||
      !mediaElement.videoHeight
    )
      throw new Error("composite_video_failed:video_decode");
    sourceFrame.width = mediaElement.videoWidth;
    sourceFrame.height = mediaElement.videoHeight;
    const sourceContext = sourceFrame.getContext("2d");
    if (!sourceContext)
      throw new Error("composite_video_failed:canvas_context");
    sourceContext.drawImage(mediaElement, 0, 0);
  } else if (sourceFrame)
    throw new Error("composite_video_failed:unexpected_video_frame");
  await renderCompositeVideoFrameAtTime({
    mediaTimeMs,
    scoreModel: model.pages,
    playbackTimeline: {
      resolve: (mediaTimeMs) =>
        resolveCompositeVideoPlaybackPosition({
          recordedPerformance,
          adapter: model.adapter,
          pageNumberResolver: (noteIds) =>
            findStablePageNumber(noteIds, model.pages),
          mediaTimeMs,
          actualMediaDurationMs: safeDurationMs(mediaElement),
        }),
    },
    sourceVideoFrame: sourceFrame ?? undefined,
    outputCanvas: frameState.stagingCanvas,
    context: frameState.stagingCtx,
    layout,
  });
  ctx.drawImage(frameState.stagingCanvas, 0, 0);
}

function canCaptureCanvasStream(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const canvas = document.createElement("canvas");
  return typeof canvas.captureStream === "function";
}

function safeDurationMs(mediaElement: HTMLMediaElement): number | null {
  return Number.isFinite(mediaElement.duration) && mediaElement.duration > 0
    ? mediaElement.duration * 1000
    : null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
