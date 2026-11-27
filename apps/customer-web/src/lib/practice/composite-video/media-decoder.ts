import type { CompositeVideoInput } from "./input";
import { releaseLocalMediaAsset } from "@/lib/practice/media/local-media-asset";

export type CompositeMediaDecoder = Readonly<{
  element: HTMLMediaElement;
  video: HTMLVideoElement | null;
  seek(mediaTimeMs: number): void;
  dispose(): Promise<void>;
}>;

/** A decoder owns one independent lease, URL and element, initially paused. */
export async function openCompositeMediaDecoder(
  input: CompositeVideoInput,
  signal?: AbortSignal,
): Promise<CompositeMediaDecoder> {
  signal?.throwIfAborted();
  const recording = input.recordedPerformance.recording;
  const lease = recording.media.retain();
  let url: string | null = null;
  const element = document.createElement(
    recording.kind === "VIDEO" ? "video" : "audio",
  );
  const video =
    recording.kind === "VIDEO" ? (element as HTMLVideoElement) : null;
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    element.pause();
    element.removeAttribute("src");
    element.load();
    element.remove();
    if (url) URL.revokeObjectURL(url);
    await releaseLocalMediaAsset(lease);
  };
  try {
    url = URL.createObjectURL(lease.blob);
    element.preload = "auto";
    element.src = url;
    if (video) video.playsInline = true;
    element.dataset.compositeDecoder = recording.kind;
    await waitForCompositeMediaData(element, signal);
    signal?.throwIfAborted();
    if (video && (!video.videoWidth || !video.videoHeight))
      throw new Error("composite_video_failed:video_decode");
    return Object.freeze({
      element,
      video,
      dispose,
      seek: (mediaTimeMs: number) => {
        element.currentTime = mediaTimeMs / 1000;
      },
    });
  } catch (error) {
    await dispose();
    throw error;
  }
}

export function waitForCompositeMediaData(
  element: HTMLMediaElement,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!element.seeking && element.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      for (const event of ["loadeddata", "canplay", "seeked"])
        element.removeEventListener(event, onReady);
      element.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onReady = () => {
      if (element.seeking || element.readyState < 2) return;
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("composite_video_failed:media_decode"));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Composite cancelled", "AbortError"));
    };
    for (const event of ["loadeddata", "canplay", "seeked"])
      element.addEventListener(event, onReady);
    element.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
