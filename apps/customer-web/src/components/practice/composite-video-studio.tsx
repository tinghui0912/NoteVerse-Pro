"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompositeVideoPreview } from "@/lib/practice/composite-video/preview";
import {
  exportCompositeVideo,
  getCompositeVideoReadiness,
} from "@/lib/practice/composite-video/export";
import type { CompositeVideoInput } from "@/lib/practice/composite-video/input";
import type { CompositeVideoConfig } from "@/lib/practice/composite-video/templates";
import { downloadCompositeVideo } from "@/lib/practice/composite-video/download";
import {
  releaseLocalMediaAsset,
  type LocalMediaAsset,
} from "@/lib/practice/media/local-media-asset";

export function CompositeVideoStudio({
  input,
  open,
  onOpenChange,
  onExportingChange,
  collapsible = true,
}: {
  input: CompositeVideoInput;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExportingChange?: (exporting: boolean) => void;
  collapsible?: boolean;
}) {
  const t = useTranslations("practice");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    "landscape",
  );
  const config = useMemo<CompositeVideoConfig>(
    () => ({ orientation }),
    [orientation],
  );
  const [status, setStatus] = useState<
    "idle" | "exporting" | "success" | "error"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef<AbortController | null>(null);
  const readiness = getCompositeVideoReadiness(input);
  useEffect(
    () => () => {
      operationRef.current?.abort();
    },
    [],
  );

  const handleExport = useCallback(async () => {
    if (operationRef.current) return;
    const operation = new AbortController();
    operationRef.current = operation;
    let output: LocalMediaAsset | null = null;
    setStatus("exporting");
    setProgress(0);
    setError(null);
    try {
      onExportingChange?.(true);
      const result = await exportCompositeVideo({
        input,
        config,
        signal: operation.signal,
        onProgress: (value) => setProgress(value.ratio),
      });
      output = result.media;
      operation.signal.throwIfAborted();
      const extension =
        result.mimeType.split(";")[0].trim().toLowerCase() === "video/mp4"
          ? "mp4"
          : "webm";
      await downloadCompositeVideo(
        output,
        `performance-score-video-${Date.now()}.${extension}`,
        operation.signal,
      );
      operation.signal.throwIfAborted();
      setProgress(1);
      setStatus("success");
    } catch (cause) {
      if (operation.signal.aborted) {
        setStatus("idle");
        setProgress(0);
      } else {
        setStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
            : t("exportScoreVideoFailedDesc"),
        );
      }
    } finally {
      try {
        if (output) await releaseLocalMediaAsset(output);
      } finally {
        operationRef.current = null;
        onExportingChange?.(false);
      }
    }
  }, [input, config, onExportingChange, t]);

  return (
    <Card
      data-testid={
        open ? "composite-video-studio" : "composite-video-entry-card"
      }
    >
      <CardHeader className="flex flex-row justify-between gap-3">
        <div>
          <CardTitle>{t("compositeVideoTitle")}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("compositeVideoDesc")}
          </p>
        </div>
        {open && collapsible && (
          <Button
            variant="ghost"
            disabled={status === "exporting"}
            onClick={() => onOpenChange(false)}
            data-testid="collapse-composite-video-studio"
          >
            {t("compositeVideoCollapseStudio")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!open ? (
          <Button
            onClick={() => onOpenChange(true)}
            data-testid="open-composite-video-studio"
          >
            {t("compositeVideoOpenAction")}
          </Button>
        ) : (
          <>
            <div
              role="group"
              aria-label={t("compositeVideoOrientationStep")}
              className="flex gap-3"
            >
              {(["landscape", "portrait"] as const).map((value) => (
                <Button
                  key={value}
                  aria-pressed={orientation === value}
                  onClick={() => setOrientation(value)}
                  disabled={status === "exporting"}
                  data-testid={`composite-video-orientation-${value}`}
                >
                  {t(
                    value === "landscape"
                      ? "compositeVideoLandscapeTitle"
                      : "compositeVideoPortraitTitle",
                  )}
                </Button>
              ))}
            </div>
            <p>
              {t(
                input.recordedPerformance.recording.kind === "AUDIO"
                  ? "compositeVideoScoreOnlyDesc"
                  : "compositeVideoSplitDesc",
              )}
            </p>
            <CompositeVideoPreview input={input} config={config} />
            {!readiness.ok && (
              <p role="status">
                {t(
                  readiness.reason === "input_unavailable"
                    ? "exportScoreVideoUnavailableScore"
                    : "exportScoreVideoUnsupportedBrowser",
                )}
              </p>
            )}
            <Button
              onClick={() => void handleExport()}
              disabled={!readiness.ok || status === "exporting"}
              data-testid="generate-composite-video"
            >
              {t("compositeVideoAction")}
            </Button>
          </>
        )}
        {status === "exporting" && (
          <div data-testid="composite-video-progress">
            <p>
              {t("exportScoreVideoProgressDesc", {
                progress: Math.round(progress * 100),
              })}
            </p>
            <progress max={1} value={progress} />
            <Button onClick={() => operationRef.current?.abort()}>
              {t("cancelExportScoreVideo")}
            </Button>
          </div>
        )}
        {status === "error" && (
          <p role="alert" data-testid="composite-video-error">
            {error}
          </p>
        )}
        {status === "success" && (
          <p data-testid="composite-video-success">
            {t("exportScoreVideoSuccessTitle")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
