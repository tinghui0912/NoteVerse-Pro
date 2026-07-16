'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_TEMPO_BPM } from '@/lib/constants/audio';
import { extractTempoBpm } from '@/lib/musicxml';
import { reportUnexpectedClientError } from '@/lib/observability';
import type { ScoreCursorScrollTarget, ScorePreviewController } from '@/lib/score-preview/contracts';

export type ScorePreviewControllerFactory = (
  container: HTMLDivElement,
  bpm: number
) => Promise<ScorePreviewController>;

const createVerovioController: ScorePreviewControllerFactory = async (container, bpm) => {
  const { VerovioScorePreviewController } = await import(
    '@/lib/score-preview/verovio-score-preview-controller'
  );
  return new VerovioScorePreviewController({ container, bpm });
};

interface UseScorePreviewPlaybackOptions {
  isOpen: boolean;
  xmlString: string | null;
  createController?: ScorePreviewControllerFactory;
  followViewport?: ScoreCursorScrollTarget;
  suspendFollowOnManualScroll?: boolean;
}

export function useScorePreviewPlayback({
  isOpen,
  xmlString,
  createController = createVerovioController,
  followViewport = 'container',
  suspendFollowOnManualScroll = true,
}: UseScorePreviewPlaybackOptions) {
  const t = useTranslations('common');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasRenderedScore, setHasRenderedScore] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isFollowSuspended, setIsFollowSuspended] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const controllerRef = useRef<ScorePreviewController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scoreContainerNodeRef = useRef<HTMLDivElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const cursorRafRef = useRef<number | null>(null);
  const manualStopRef = useRef(false);
  const wasPlayingBeforeSeekRef = useRef(false);
  const seekTargetStepRef = useRef<number | null>(null);
  const previousPlayingRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const loadedXmlRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const followSuspendedRef = useRef(false);

  const updateFollowSuspended = useCallback((suspended: boolean) => {
    followSuspendedRef.current = suspended;
    setIsFollowSuspended(suspended);
  }, []);

  const stopProgressLoop = useCallback(() => {
    if (progressRafRef.current !== null) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  }, []);

  const stopCursorLoop = useCallback(() => {
    if (cursorRafRef.current !== null) {
      cancelAnimationFrame(cursorRafRef.current);
      cursorRafRef.current = null;
    }
  }, []);

  const startProgressLoop = useCallback(() => {
    stopProgressLoop();
    const update = () => {
      const snapshot = controllerRef.current?.getPlaybackSnapshot();
      if (snapshot) {
        setCurrentTime(snapshot.currentTime);
        setProgress(snapshot.duration > 0 ? (snapshot.currentTime / snapshot.duration) * 100 : 0);
      }
      progressRafRef.current = requestAnimationFrame(update);
    };
    progressRafRef.current = requestAnimationFrame(update);
  }, [stopProgressLoop]);

  const startCursorLoop = useCallback(() => {
    stopCursorLoop();
    const controller = controllerRef.current;
    if (!controller) return;
    const update = () => {
      const snapshot = controller.getPlaybackSnapshot();
      if (snapshot.state !== 'PLAYING') return;
      const target = Math.max(0, Math.min(snapshot.currentStep, snapshot.totalSteps - 1));
      const syncCursor = controller.syncCursorDuringPlayback?.bind(controller) ?? controller.syncCursorToStep.bind(controller);
      syncCursor(target, {
        scrollIntoView: !followSuspendedRef.current,
        scrollTarget: followViewport,
      });
      cursorRafRef.current = requestAnimationFrame(update);
    };
    cursorRafRef.current = requestAnimationFrame(update);
  }, [followViewport, stopCursorLoop]);

  const resetState = useCallback(() => {
    stopProgressLoop();
    stopCursorLoop();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setProgress(0);
    setCurrentTime(0);
  }, [stopCursorLoop, stopProgressLoop]);

  const disposeController = useCallback(() => {
    loadGenerationRef.current += 1;
    stopProgressLoop();
    stopCursorLoop();
    const controller = controllerRef.current;
    controllerRef.current = null;
    loadedXmlRef.current = null;
    controller?.dispose();
  }, [stopCursorLoop, stopProgressLoop]);

  const loadScore = useCallback(async (container: HTMLDivElement) => {
    if (!isOpen || !xmlString || controllerRef.current) return;
    const generation = ++loadGenerationRef.current;
    setIsLoading(true);
    setLoadError(null);
    let controller: ScorePreviewController | null = null;

    try {
      controller = await createController(
        container,
        extractTempoBpm(xmlString, DEFAULT_TEMPO_BPM)
      );
      if (generation !== loadGenerationRef.current) {
        controller.dispose();
        return;
      }
      controllerRef.current = controller;
      await controller.loadScore(xmlString);
      if (generation !== loadGenerationRef.current || controllerRef.current !== controller) return;

      controller.onPlaybackIteration((notes) => {
        if (!followSuspendedRef.current) {
          controller?.ensureCursorVisible({ scrollTarget: followViewport });
        }
        if (notes.length === 0 && controller?.getPlaybackSnapshot().state === 'PLAYING') {
          void controller.stop();
        }
      });
      controller.onPlaybackStateChange((state) => {
        if (controllerRef.current !== controller) return;
        if (state === 'PLAYING') {
          isPlayingRef.current = true;
          setIsPlaying(true);
          startProgressLoop();
          startCursorLoop();
        } else if (state === 'PAUSED') {
          isPlayingRef.current = false;
          setIsPlaying(false);
          stopProgressLoop();
          stopCursorLoop();
        } else if (state === 'STOPPED') {
          resetState();
          updateFollowSuspended(false);
          controller?.hideCursor();
        }
      });

      const duration = controller.getPlaybackSnapshot().duration;
      loadedXmlRef.current = xmlString;
      setHasRenderedScore(true);
      setTotalTime(duration > 0 ? duration : 0);
      setIsLoading(false);
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'score_preview_playback',
        action: 'load_score',
      });
      if (controller && controllerRef.current === controller) {
        controllerRef.current = null;
        controller.dispose();
      }
      if (generation === loadGenerationRef.current) {
        setLoadError(t('errorBoundaryDesc'));
        setIsLoading(false);
      }
    }
  }, [createController, followViewport, isOpen, resetState, startCursorLoop, startProgressLoop, stopCursorLoop, stopProgressLoop, t, updateFollowSuspended, xmlString]);

  const scoreContainerRef = useCallback((node: HTMLDivElement | null) => {
    scoreContainerNodeRef.current = node;
    if (node && isOpen && !controllerRef.current) void loadScore(node);
  }, [isOpen, loadScore]);

  useEffect(() => {
    const scoreContainer = scoreContainerNodeRef.current;
    if (!isOpen || !xmlString || !scoreContainer) return;
    if (!loadedXmlRef.current || loadedXmlRef.current === xmlString) return;
    const controller = controllerRef.current;
    if (!controller) return;
    const generation = ++loadGenerationRef.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || generation !== loadGenerationRef.current) return;
      resetState();
      setIsLoading(true);
      setLoadError(null);
      updateFollowSuspended(false);
      void controller.loadScore(xmlString).then(() => {
        if (cancelled || generation !== loadGenerationRef.current || controllerRef.current !== controller) return;
        loadedXmlRef.current = xmlString;
        const duration = controller.getPlaybackSnapshot().duration;
        setTotalTime(duration > 0 ? duration : 0);
        setHasRenderedScore(true);
        setIsLoading(false);
      }).catch((error) => {
        if (cancelled || generation !== loadGenerationRef.current || controllerRef.current !== controller) return;
        reportUnexpectedClientError(error, {
          area: 'score_preview_playback',
          action: 'reload_score',
        });
        setLoadError(t('errorBoundaryDesc'));
        setIsLoading(false);
      });
    });
    return () => { cancelled = true; };
  }, [isOpen, resetState, t, updateFollowSuspended, xmlString]);

  useEffect(() => {
    if (isOpen) return;
    disposeController();
    const resetTimer = window.setTimeout(() => {
      resetState();
      setIsLooping(false);
      setIsLoading(true);
      setHasRenderedScore(false);
      setLoadError(null);
      setTotalTime(0);
      updateFollowSuspended(false);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [disposeController, isOpen, resetState, updateFollowSuspended]);

  useEffect(() => () => disposeController(), [disposeController]);

  useEffect(() => {
    if (!isOpen || followViewport !== 'window' || !suspendFollowOnManualScroll) return;

    const suspendFollow = () => {
      if (isPlayingRef.current) updateFollowSuspended(true);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.matches('input, textarea, select')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        suspendFollow();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.clientX >= window.innerWidth - 24) suspendFollow();
    };

    window.addEventListener('wheel', suspendFollow, { passive: true });
    window.addEventListener('touchmove', suspendFollow, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('wheel', suspendFollow);
      window.removeEventListener('touchmove', suspendFollow);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [followViewport, isOpen, suspendFollowOnManualScroll, updateFollowSuspended]);

  useEffect(() => {
    if (!isOpen || !containerRef.current || !controllerRef.current) return;
    let lastWidth = containerRef.current.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || Math.abs(width - lastWidth) < 1) return;
      lastWidth = width;
      void controllerRef.current?.fitToContainer();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isOpen, isLoading]);

  const repeat = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || isLoading) return;
    try {
      await controller.stop();
      await controller.play();
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'score_preview_playback',
        action: 'repeat',
      });
    }
  }, [isLoading]);

  useEffect(() => {
    const stoppedNaturally = previousPlayingRef.current && !isPlaying && !manualStopRef.current;
    previousPlayingRef.current = isPlaying;
    if (isPlaying) manualStopRef.current = false;
    if (stoppedNaturally && isLooping) {
      const timeoutId = setTimeout(() => void repeat(), 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isLooping, isPlaying, repeat]);

  const toggleLoop = useCallback(() => setIsLooping((value) => !value), []);

  const playPause = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || isLoading) return;
    if (controller.getPlaybackSnapshot().state === 'PLAYING') {
      manualStopRef.current = true;
      await controller.pause();
      return;
    }
    try {
      if (seekTargetStepRef.current !== null) {
        await controller.playFromStep(seekTargetStepRef.current);
        seekTargetStepRef.current = null;
      } else {
        if (controller.getPlaybackSnapshot().currentTime === 0) {
          controller.resetCursor({ scrollIntoView: true, scrollTarget: followViewport });
        }
        await controller.play();
      }
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'score_preview_playback',
        action: 'play_pause',
      });
    }
  }, [followViewport, isLoading]);

  const stop = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    manualStopRef.current = true;
    await controller.stop();
    controller.hideCursor();
    updateFollowSuspended(false);
    resetState();
  }, [resetState, updateFollowSuspended]);

  const seekStart = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    wasPlayingBeforeSeekRef.current = controller.getPlaybackSnapshot().state === 'PLAYING';
    if (wasPlayingBeforeSeekRef.current) {
      manualStopRef.current = true;
      void controller.pause();
    }
    stopProgressLoop();
    stopCursorLoop();
  }, [stopCursorLoop, stopProgressLoop]);

  const seek = useCallback((value: number[]) => {
    const controller = controllerRef.current;
    if (!controller || totalTime <= 0) return;
    const percentage = Math.max(0, Math.min(1, value[0] / 100));
    const totalSteps = controller.getPlaybackSnapshot().totalSteps;
    const targetStep = Math.min(Math.floor(totalSteps * percentage), Math.max(0, totalSteps - 1));
    const cursorOptions = {
      scrollIntoView: !followSuspendedRef.current,
      scrollTarget: followViewport,
    };
    if (percentage === 0) {
      void controller.seek(0);
      controller.resetCursor(cursorOptions);
      seekTargetStepRef.current = null;
    } else {
      controller.syncCursorToStep(targetStep, {
        ...cursorOptions,
        alignBeforeFirstEventToMeasureStart: false,
      });
      seekTargetStepRef.current = targetStep;
    }
    setCurrentTime(totalTime * percentage);
    setProgress(percentage * 100);
  }, [followViewport, totalTime]);

  const returnToPlaybackPosition = useCallback(() => {
    updateFollowSuspended(false);
    controllerRef.current?.ensureCursorVisible({
      scrollTarget: followViewport,
      force: true,
    });
  }, [followViewport, updateFollowSuspended]);

  const seekEnd = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    manualStopRef.current = false;
    if (wasPlayingBeforeSeekRef.current) {
      try {
        if (seekTargetStepRef.current !== null) {
          await controller.playFromStep(seekTargetStepRef.current);
          seekTargetStepRef.current = null;
        } else {
          await controller.play();
        }
        startProgressLoop();
        startCursorLoop();
      } catch (error) {
        reportUnexpectedClientError(error, {
          area: 'score_preview_playback',
          action: 'seek_end_resume',
        });
      }
    }
    wasPlayingBeforeSeekRef.current = false;
  }, [startCursorLoop, startProgressLoop]);

  return {
    containerRef,
    currentTime,
    hasRenderedScore,
    isLoading,
    isLooping,
    isPlaying,
    isFollowSuspended,
    loadError,
    playPause,
    progress,
    returnToPlaybackPosition,
    scoreContainerRef,
    seek,
    seekEnd,
    seekStart,
    stop,
    toggleLoop,
    totalTime,
  };
}
