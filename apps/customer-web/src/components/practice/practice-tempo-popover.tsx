"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Gauge, Minus, Plus, RotateCcw, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TempoSegment } from "@/lib/practice/score/artifact";
import {
  isCustomTempoValid,
  effectiveScoreTempoAtTick,
  type PracticeTempoSelection,
} from "@/lib/practice/planning/tempo";

export type PracticeTempoPopoverProps = {
  tempoSelection: PracticeTempoSelection;
  scoreTempoSegments?: readonly TempoSegment[];
  scopeStartTick?: number;
  tempoLocked?: boolean;
  onTempoSelectionChange: (selection: PracticeTempoSelection) => void;
  metronomeEnabled?: boolean;
  onMetronomeEnabledChange?: (enabled: boolean) => void;
  className?: string;
};

function CustomBpmInput({
  bpm,
  locked,
  onCommit,
}: {
  bpm: number;
  locked: boolean;
  onCommit: (bpm: number) => void;
}) {
  const [draft, setDraft] = React.useState(String(bpm));
  const valid = isCustomTempoValid(Number(draft));
  const commit = () => {
    if (!locked && valid && draft !== String(bpm)) onCommit(Number(draft));
  };
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      aria-label="BPM input"
      aria-invalid={!valid}
      value={draft}
      disabled={locked}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setDraft(String(bpm));
        }
      }}
      className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-center tabular-nums text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

export function PracticeTempoPopover({
  tempoSelection,
  scoreTempoSegments = [],
  scopeStartTick = 0,
  tempoLocked = false,
  onTempoSelectionChange,
  metronomeEnabled = false,
  onMetronomeEnabledChange,
  className,
}: PracticeTempoPopoverProps) {
  const t = useTranslations("practice");

  const effectiveTempo = effectiveScoreTempoAtTick(
    scoreTempoSegments,
    scopeStartTick,
  );
  const initialBpm = effectiveTempo.bpm;
  const hasExplicit = effectiveTempo.source === "MUSICXML";
  const isDefaultWithLaterChanges =
    effectiveTempo.source === "PRODUCT_DEFAULT" &&
    effectiveTempo.hasSubsequentScoreTempoChanges;
  const isMusicXmlWithChanges =
    effectiveTempo.source === "MUSICXML" &&
    effectiveTempo.hasSubsequentScoreTempoChanges;
  const isMusicXmlSingle =
    effectiveTempo.source === "MUSICXML" &&
    !effectiveTempo.hasSubsequentScoreTempoChanges;

  const currentBpm =
    tempoSelection.mode === "CUSTOM_FIXED_BPM"
      ? tempoSelection.bpm
      : initialBpm;

  // Single trigger label: [速度 · 原速] or [速度 · 80 BPM]
  const triggerLabel =
    tempoSelection.mode === "CUSTOM_FIXED_BPM"
      ? `${t("tempoButton")} · ${tempoSelection.bpm} BPM`
      : hasExplicit
        ? `${t("tempoButton")} · ${t("tempoScoreMode")}`
        : `${t("tempoButton")} · ${initialBpm} BPM`;

  const handleAdjustBpm = (delta: number) => {
    const nextBpm = currentBpm + delta;
    if (tempoLocked || !isCustomTempoValid(nextBpm)) return;
    onTempoSelectionChange({
      mode: "CUSTOM_FIXED_BPM",
      bpm: nextBpm,
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-11 gap-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            className,
          )}
          aria-label={t("tempoButton")}
        >
          <Gauge className="h-4 w-4" aria-hidden="true" />
          <span className="tabular-nums">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">
            {t("settingsTempoAndMetronome")}
          </h4>
          <span className="text-xs font-medium text-slate-400">
            {tempoSelection.mode === "SCORE"
              ? t("tempoScoreMode")
              : t("tempoCustomMode")}
          </span>
        </div>

        {/* Score original tempo description */}
        <p className="mt-1 text-xs text-slate-500">
          {isDefaultWithLaterChanges
            ? t("tempoOriginalDefaultWithLaterChanges", { bpm: initialBpm })
            : isMusicXmlWithChanges
              ? t("tempoOriginalWithChanges", { bpm: initialBpm })
              : isMusicXmlSingle
                ? t("tempoOriginal", { bpm: initialBpm })
                : t("tempoOriginalDefault")}
        </p>

        {tempoLocked ? (
          <p className="mt-1.5 text-xs font-medium text-amber-600">
            {t("tempoLockedNotice")}
          </p>
        ) : null}

        {/* BPM Stepper and Display */}
        <div className="mt-3.5 rounded-md border border-slate-200 bg-slate-50/50 p-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="-5 BPM"
              disabled={tempoLocked || currentBpm - 5 <= 0}
              onClick={() => handleAdjustBpm(-5)}
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center">
              <span className="text-base font-bold tabular-nums text-slate-900">
                {currentBpm} BPM
              </span>
            </div>
            <button
              type="button"
              aria-label="+5 BPM"
              disabled={tempoLocked || !isCustomTempoValid(currentBpm + 5)}
              onClick={() => handleAdjustBpm(5)}
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3">
            <CustomBpmInput
              key={currentBpm}
              bpm={currentBpm}
              locked={tempoLocked}
              onCommit={(bpm) =>
                onTempoSelectionChange({ mode: "CUSTOM_FIXED_BPM", bpm })
              }
            />
          </div>

          {/* Restore Original Tempo */}
          <div className="mt-2.5 flex justify-center border-t border-slate-200/60 pt-2">
            <button
              type="button"
              disabled={tempoLocked || tempoSelection.mode === "SCORE"}
              onClick={() => onTempoSelectionChange({ mode: "SCORE" })}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              <span>
                {hasExplicit
                  ? t("restoreOriginalTempo")
                  : t("restoreDefaultTempo")}
              </span>
            </button>
          </div>
        </div>

        {/* Metronome Sound Toggle - always operable even during practice */}
        <div className="mt-4 flex items-center justify-between border-t border-slate-200/80 pt-3">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-900">
              {t("metronomeSound")}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant={metronomeEnabled ? "default" : "outline"}
            onClick={() => onMetronomeEnabledChange?.(!metronomeEnabled)}
            className={cn(
              "h-8 px-3 text-xs font-semibold",
              metronomeEnabled
                ? "border-orange-300 bg-orange-50 text-orange-950 hover:bg-orange-100"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
            aria-pressed={metronomeEnabled}
            aria-label={t("metronomeSound")}
          >
            {metronomeEnabled ? t("metronomeOn") : t("metronomeOff")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
