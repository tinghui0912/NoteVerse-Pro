"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CompositeVideoInput } from "./input";
import {
  openCompositeMediaDecoder,
  waitForCompositeMediaData,
  type CompositeMediaDecoder,
} from "./media-decoder";
import {
  prepareCompositeScoreModel,
  findStablePageNumber,
  type CompositeScoreModel,
} from "./score-model";
import { renderCompositeVideoFrameAtTime } from "./frame-renderer";
import { resolveCompositeVideoPlaybackPosition } from "./playback-position";
import {
  getCompositeVideoLayout,
  type CompositeVideoConfig,
} from "./templates";
import { microsecondsToMilliseconds } from "@/lib/practice/recording/recording-timebase";

function formatTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Independent, initially paused original-media decoder and clean-score renderer. */
export function CompositeVideoPreview({
  input,
  config,
}: {
  input: CompositeVideoInput;
  config: CompositeVideoConfig;
}) {
  const t = useTranslations("practice");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaHostRef = useRef<HTMLDivElement>(null);
  const decoderRef = useRef<CompositeMediaDecoder | null>(null);
  const [status, setStatus] = useState<"preparing" | "ready" | "error">(
    "preparing",
  );
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const nominalDuration = microsecondsToMilliseconds(
    input.recordedPerformance.recording.timebase.nominalMediaDurationUs,
  );
  const [durationMs, setDurationMs] = useState(nominalDuration);

  useEffect(() => {
    const controller = new AbortController();
    let decoder: CompositeMediaDecoder | null = null;
    let model: CompositeScoreModel | null = null;
    let frameId: number | null = null;
    let rendering = false,
      pending = false;
    const disposed = () => controller.signal.aborted;
    const layout = getCompositeVideoLayout(
      config,
      input.recordedPerformance.recording.kind,
    );
    const staging = document.createElement("canvas");
    staging.width = layout.width;
    staging.height = layout.height;
    const sourceFrame =
      input.recordedPerformance.recording.kind === "VIDEO"
        ? document.createElement("canvas")
        : null;
    const publish = () => {
      if (!decoder || disposed()) return;
      setTimeMs(Math.max(0, decoder.element.currentTime * 1000));
      setDurationMs(
        Number.isFinite(decoder.element.duration) &&
          decoder.element.duration > 0
          ? decoder.element.duration * 1000
          : nominalDuration,
      );
    };
    const render = async () => {
      pending = true;
      if (rendering) return;
      rendering = true;
      try {
        while (pending && !disposed() && decoder && model) {
          pending = false;
          await waitForCompositeMediaData(decoder.element, controller.signal);
          if (disposed()) return;
          const mediaTimeMs = Math.max(0, decoder.element.currentTime * 1000);
          // Freeze video pixels and their media time before asynchronous score image work.
          if (sourceFrame && decoder.video) {
            sourceFrame.width = decoder.video.videoWidth;
            sourceFrame.height = decoder.video.videoHeight;
            const context = sourceFrame.getContext("2d");
            if (!context)
              throw new Error(t("compositeVideoPreviewFrameBufferFailed"));
            context.drawImage(decoder.video, 0, 0);
          }
          const currentModel = model;
          await renderCompositeVideoFrameAtTime({
            mediaTimeMs,
            scoreModel: currentModel.pages,
            playbackTimeline: {
              resolve: (time) =>
                resolveCompositeVideoPlaybackPosition({
                  recordedPerformance: input.recordedPerformance,
                  adapter: currentModel.adapter,
                  pageNumberResolver: (ids) =>
                    findStablePageNumber(ids, currentModel.pages),
                  mediaTimeMs: time,
                  actualMediaDurationMs:
                    Number.isFinite(decoder!.element.duration) &&
                    decoder!.element.duration > 0
                      ? decoder!.element.duration * 1000
                      : null,
                }),
            },
            sourceVideoFrame: sourceFrame ?? undefined,
            outputCanvas: staging,
            layout,
          });
          if (disposed() || pending) continue;
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (!canvas || !context)
            throw new Error(t("compositeVideoPreviewCanvasFailed"));
          canvas.width = layout.width;
          canvas.height = layout.height;
          context.drawImage(staging, 0, 0);
          setStatus("ready");
        }
      } catch (cause) {
        if (!disposed()) {
          decoder?.element.pause();
          setError(
            cause instanceof Error
              ? cause.message
              : t("compositeVideoPreviewFailed"),
          );
          setStatus("error");
        }
      } finally {
        rendering = false;
      }
    };
    const tick = () => {
      if (!decoder || disposed() || decoder.element.paused) return;
      publish();
      void render();
      frameId = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      if (frameId !== null) cancelAnimationFrame(frameId);
      tick();
    };
    const onPause = () => {
      setPlaying(false);
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      publish();
      void render();
    };
    const onSeek = () => {
      publish();
      void render();
    };
    const onError = () => {
      decoder?.element.pause();
      setError(t("compositeVideoPreviewDecodeFailed"));
      setStatus("error");
    };
    void (async () => {
      setStatus("preparing");
      setError(null);
      setPlaying(false);
      setTimeMs(0);
      decoder = await openCompositeMediaDecoder(input, controller.signal);
      if (disposed()) {
        await decoder.dispose();
        return;
      }
      decoderRef.current = decoder;
      mediaHostRef.current?.appendChild(decoder.element);
      const element = decoder.element;
      element.addEventListener("play", onPlay);
      element.addEventListener("pause", onPause);
      element.addEventListener("ended", onPause);
      element.addEventListener("seeked", onSeek);
      element.addEventListener("timeupdate", publish);
      element.addEventListener("durationchange", publish);
      element.addEventListener("error", onError);
      publish();
      model = await prepareCompositeScoreModel({
        musicXml: input.musicXml,
        artifact: input.recordedPerformance.executed.bundle.artifact,
        signal: controller.signal,
      });
      if (disposed()) {
        model.dispose();
        return;
      }
      await render();
    })().catch((cause) => {
      if (!disposed()) {
        setError(
          cause instanceof Error
            ? cause.message
            : t("compositeVideoPreviewFailed"),
        );
        setStatus("error");
      }
    });
    return () => {
      controller.abort();
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (decoder) {
        const element = decoder.element;
        element.removeEventListener("play", onPlay);
        element.removeEventListener("pause", onPause);
        element.removeEventListener("ended", onPause);
        element.removeEventListener("seeked", onSeek);
        element.removeEventListener("timeupdate", publish);
        element.removeEventListener("durationchange", publish);
        element.removeEventListener("error", onError);
        void decoder.dispose();
      }
      decoderRef.current = null;
      model?.dispose();
    };
  }, [input, config, nominalDuration, t]);

  return (
    <div className="space-y-3" data-testid="composite-video-preview">
      <div ref={mediaHostRef} hidden aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="block h-auto max-h-[min(55dvh,480px)] max-w-full"
        aria-label={t("compositeVideoPreviewCanvasLabel")}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={status !== "ready"}
          onClick={() => {
            const element = decoderRef.current?.element;
            if (!element) return;
            if (!element.paused) element.pause();
            else
              void element.play().catch(() => {
                setError(t("compositeVideoPreviewDecodeFailed"));
                setStatus("error");
              });
          }}
          data-testid="composite-preview-play"
        >
          {playing ? t("pauseRecording") : t("playRecording")}
        </button>
        <input
          type="range"
          aria-label={t("compositeVideoPreviewSeek")}
          min={0}
          max={Math.max(1, durationMs)}
          step={1}
          value={Math.min(timeMs, durationMs)}
          disabled={status !== "ready"}
          onChange={(event) => {
            decoderRef.current?.seek(Number(event.target.value));
          }}
        />
        <span className="text-xs tabular-nums">
          {formatTime(timeMs)} / {formatTime(durationMs)}
        </span>
      </div>
      {status === "preparing" && <p>{t("compositeVideoPreviewPreparing")}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
