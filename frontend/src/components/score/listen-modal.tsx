
'use client';

import { useTranslations } from 'next-intl';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Pause, Play, Repeat, Square, X, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_TEMPO_BPM, ESTIMATED_BEATS_PER_STEP } from '@/lib/constants/audio';
import { extractTempoBpm } from '@/lib/musicxml';
import {
  OsmdScorePreviewController,
  type ScorePreviewController,
} from '@/lib/score';

interface ListenModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  xmlString: string | null;
  children?: React.ReactNode;
}

export function ListenModal({ isOpen, onOpenChange, xmlString, children }: ListenModalProps) {
  const t = useTranslations('common');
  const tResults = useTranslations('results');
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLooping, setIsLooping] = useState(false); // Loop playback state

  const managerRef = useRef<ScorePreviewController | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const cursorRafRef = useRef<number | null>(null);
  const effectiveTempoRef = useRef<number>(DEFAULT_TEMPO_BPM); // Store the actual BPM being used
  const isManualStopRef = useRef<boolean>(false); // Track manual stop/pause to prevent loop trigger
  const isSeekingRef = useRef<boolean>(false); // Track if user is dragging progress bar
  const wasPlayingBeforeSeek = useRef<boolean>(false); // Track playback state before seek
  const seekTargetStepRef = useRef<number | null>(null); // Store pending seek position

  const osmdContainerRef = useRef<HTMLDivElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  const isControlled = isOpen !== undefined && onOpenChange !== undefined;
  const currentOpenState = isControlled ? isOpen : internalIsOpen;

  const setCurrentOpenState = useCallback((open: boolean) => {
    if (isControlled) {
      onOpenChange(open);
    } else {
      setInternalIsOpen(open);
    }
  }, [isControlled, onOpenChange]);

  const stopProgressLoop = useCallback(() => {
    if (progressRafRef.current) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  }, []);

  const stopCursorSyncLoop = useCallback(() => {
    if (cursorRafRef.current) {
      cancelAnimationFrame(cursorRafRef.current);
      cursorRafRef.current = null;
    }
  }, []);

  const resetPlayback = useCallback(() => {
    // Only reset UI state, do NOT call player.stop() to avoid infinite loop
    stopProgressLoop();
    stopCursorSyncLoop();

    managerRef.current?.resetCursor();

    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  }, [stopProgressLoop, stopCursorSyncLoop]);

  /**
   * Calculate playback time and duration with multiple fallback strategies.
   * Matches Melody Forge's time calculation logic.
   */
  const calculatePlaybackTime = useCallback((
    playbackTime: number,
    totalSteps: number,
    currentStep: number,
    effectiveBpm: number = DEFAULT_TEMPO_BPM
  ) => {
    const stepProgress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
    let currentTime = playbackTime;

    // Calculate duration from steps and BPM directly (don't trust player.duration)
    let duration = 0;
    if (totalSteps > 0 && effectiveBpm > 0) {
      duration = (totalSteps * ESTIMATED_BEATS_PER_STEP * 60) / effectiveBpm;
    }

    // Calculate currentTime from progress if not available
    if (duration > 0 && currentTime <= 0) {
      currentTime = (stepProgress / 100) * duration;
    }

    return { currentTime, stepProgress };
  }, []);

  const startProgressLoop = useCallback(() => {
    stopProgressLoop();
    const loop = () => {
      const manager = managerRef.current;
      if (manager) {
        const snapshot = manager.getPlaybackSnapshot();

        // Use the stored effective BPM instead of player.bpm which is unreliable
        const actualBpm = effectiveTempoRef.current;
        const { currentTime, stepProgress } = calculatePlaybackTime(
          snapshot.currentTime,
          snapshot.totalSteps,
          snapshot.currentStep,
          actualBpm
        );

        setCurrentTime(currentTime);
        setProgress(stepProgress);
      }
      progressRafRef.current = requestAnimationFrame(loop);
    };
    progressRafRef.current = requestAnimationFrame(loop);
  }, [stopProgressLoop, calculatePlaybackTime]);

  const startCursorSyncLoop = useCallback(() => {
    stopCursorSyncLoop();
    const manager = managerRef.current;
    if (!manager) return;

    const loop = () => {
      const snapshot = manager.getPlaybackSnapshot();
      if (snapshot.state === 'PLAYING') {
        const raw = snapshot.currentStep;
        const total = snapshot.totalSteps;

        // Limit target to [0, total-1] range to prevent going beyond last note
        const target = Math.max(0, Math.min((typeof raw === 'number' ? raw - 1 : 0), total - 1));
        manager.syncCursorToStep(target, { scrollIntoView: true });

        cursorRafRef.current = requestAnimationFrame(loop);
      }
    };
    cursorRafRef.current = requestAnimationFrame(loop);
  }, [stopCursorSyncLoop]);

  const disposeController = useCallback(() => {
    stopProgressLoop();
    stopCursorSyncLoop();
    if (managerRef.current) {
      managerRef.current.dispose();
      managerRef.current = null;
    }
  }, [stopProgressLoop, stopCursorSyncLoop]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      disposeController();
      resetPlayback();
      setIsLooping(false);
      setIsLoading(true);
    }
    setCurrentOpenState(open);
  }, [disposeController, resetPlayback, setCurrentOpenState]);

  const handleClose = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  // Handle repeat playback
  const handleRepeat = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager || isLoading) {
      return;
    }

    try {
      await manager.stop();
      await manager.play();
    } catch (error) {
      console.error('[handleRepeat] Error during repeat:', error);
    }
  }, [isLoading]);

  // Toggle loop playback
  const handleLoopToggle = useCallback(() => {
    setIsLooping(prev => !prev);
  }, []);

  useEffect(() => {
    if (!currentOpenState) {
      disposeController();
    }
  }, [currentOpenState, disposeController]);

  // Track previous playing state to detect falling edge (Playing -> Stopped)
  const prevIsPlayingRef = useRef(false);
  // Track if playback has started at least once
  const hasPlayedRef = useRef(false);

  // Detect playback end for loop functionality
  useEffect(() => {
    const isPlayingTransitionToStopped = prevIsPlayingRef.current && !isPlaying;

    // Update ref for next render
    prevIsPlayingRef.current = isPlaying;

    // Track when playback starts
    if (isPlaying) {
      hasPlayedRef.current = true;
      isManualStopRef.current = false; // Reset manual stop flag
    }

    // Only trigger loop if we JUST stopped naturally
    if (isPlayingTransitionToStopped && isLooping && !isManualStopRef.current) {
      const timeoutId = setTimeout(() => {
        handleRepeat();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [isPlaying, isLooping, handleRepeat]);

  const loadScore = useCallback(async (container: HTMLDivElement) => {
    if (!xmlString || managerRef.current) return;

    setIsLoading(true);

    try {
      const effectiveTempo = extractTempoBpm(xmlString, DEFAULT_TEMPO_BPM);

      // Store the effective tempo for later use
      effectiveTempoRef.current = effectiveTempo;
      const manager: ScorePreviewController = new OsmdScorePreviewController({
        container,
        bpm: effectiveTempo,
      });
      managerRef.current = manager;

      await manager.loadScore(xmlString);

      manager.onPlaybackIteration((notes) => {
        manager.ensureCursorVisible();
        if (
          Array.isArray(notes) &&
          notes.length === 0 &&
          manager.getPlaybackSnapshot().state === 'PLAYING'
        ) {
          void manager.stop();
        }
      });

      manager.onPlaybackStateChange((state) => {
        if (state === 'PLAYING') {
          setIsPlaying(true);
          startProgressLoop();
          startCursorSyncLoop();
        } else if (state === 'PAUSED') {
          setIsPlaying(false);
          stopProgressLoop();
          stopCursorSyncLoop();
        } else if (state === 'STOPPED') {
          setIsPlaying(false);
          stopProgressLoop();
          stopCursorSyncLoop();
          setProgress(0);
          setCurrentTime(0);
          manager.resetCursor({ scrollIntoView: true });
        }
      });

      const snapshot = manager.getPlaybackSnapshot();
      let duration = snapshot.duration;
      if (duration <= 0 && snapshot.totalSteps > 0) {
        duration =
          (snapshot.totalSteps * ESTIMATED_BEATS_PER_STEP * 60) / effectiveTempo;
      }
      if (duration > 0) {
        setTotalTime(duration);
      }
      setIsLoading(false);
    } catch (error) {
      console.error('[ListenModal] Error initializing score:', error);
      setIsLoading(false);
    }
  }, [xmlString, startProgressLoop, stopProgressLoop, startCursorSyncLoop, stopCursorSyncLoop]);

  const modalBodyRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      osmdContainerRef.current = node;

      // Load score immediately without artificial delay
      if (currentOpenState && !managerRef.current) {
        loadScore(node);
      }
    }
  }, [currentOpenState, loadScore]);



  // Watch for container size changes and adjust zoom accordingly
  useEffect(() => {
    if (!modalContainerRef.current || !managerRef.current) return;

    let lastWidth = modalContainerRef.current.clientWidth;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const currentWidth = entry.contentRect.width;

      // Only trigger if width has changed (ignore height changes)
      if (Math.abs(currentWidth - lastWidth) < 1) return;

      lastWidth = currentWidth;

      // Call fitToContainer directly without debounce
      if (managerRef.current) {
        managerRef.current.fitToContainer();
      }
    });

    resizeObserver.observe(modalContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [currentOpenState]);

  // Removed unreliable useEffect for loading score

  // Removed cursor style injection (osmd-cursor-fix-style)
  // The OSMD adapter waits for a measurable container before rendering.
  // OSMD renders with correct dimensions, making this fallback unnecessary.

  const handlePlayPause = async () => {
    const manager = managerRef.current;

    if (!manager || isLoading) {
      return;
    }

    if (manager.getPlaybackSnapshot().state === 'PLAYING') {
      isManualStopRef.current = true; // Mark as manual stop
      await manager.pause();
    } else {
      try {
        // Check if we have a pending seek position from dragging
        // Fix: Use >= 0 to allow seeking to the very beginning (step 0)
        if (seekTargetStepRef.current !== null && seekTargetStepRef.current >= 0) {
          // Use playFromStep which internally uses player.jumpToStep() API
          await manager.playFromStep(seekTargetStepRef.current);

          // Clear the seek target after applying
          seekTargetStepRef.current = null;
        } else {
          // Normal play from current position or beginning
          // manager.play() handles:
          // - Duplicate call protection
          // - AudioContext resume
          // - End detection and restart
          await manager.play();
        }
      } catch (error) {
        console.error('[handlePlayPause] Error calling play():', error);
      }
    }
  };

  const handleStop = async () => {
    const manager = managerRef.current;

    if (manager) {
      isManualStopRef.current = true; // Mark as manual stop
      await manager.stop();
      manager.resetCursor();

      // Trigger UI reset manually
      setIsPlaying(false);
      stopProgressLoop();
      stopCursorSyncLoop();
      setProgress(0);
      setCurrentTime(0);
    }
  };

  const handleSeekStart = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    isSeekingRef.current = true;
    wasPlayingBeforeSeek.current = manager.getPlaybackSnapshot().state === 'PLAYING';

    // Pause playback and update loops (smart mode)
    if (wasPlayingBeforeSeek.current) {
      isManualStopRef.current = true; // Prevent loop trigger when pausing for seek
      void manager.pause();
    }

    stopProgressLoop();
    stopCursorSyncLoop();
  }, [stopProgressLoop, stopCursorSyncLoop]);

  const handleSeek = useCallback((value: number[]) => {
    const manager = managerRef.current;

    if (!manager || totalTime <= 0) {
      console.warn('[handleSeek] Cannot seek: invalid state');
      return;
    }

    const percentage = value[0] / 100;

    // 1. Calculate target step
    const totalSteps = manager.getPlaybackSnapshot().totalSteps;
    const targetStep = Math.min(
      Math.floor(totalSteps * percentage),
      Math.max(0, totalSteps - 1) // Prevent out of bounds
    );

    // 2. Sync cursor
    manager.resetCursor();
    manager.syncCursorToStep(targetStep, { scrollIntoView: true });

    // 3. Store seek target for playFromStep when play is clicked
    seekTargetStepRef.current = targetStep;

    // 4. Update UI immediately
    const newTime = totalTime * percentage;
    setCurrentTime(newTime);
    setProgress(value[0]);

  }, [totalTime]);

  const handleSeekEnd = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) return;

    isSeekingRef.current = false;
    isManualStopRef.current = false; // Reset manual stop flag so loop can work again

    // Resume playback state if was playing before
    if (wasPlayingBeforeSeek.current) {
      try {
        // Fix: If we have a seek target, use playFromStep to resume from new position
        if (seekTargetStepRef.current !== null && seekTargetStepRef.current >= 0) {
          await manager.playFromStep(seekTargetStepRef.current);
          seekTargetStepRef.current = null;
        } else {
          await manager.play();
        }

        startProgressLoop();
        startCursorSyncLoop();
      } catch (error) {
        console.error('[handleSeekEnd] Resume error:', error);
      }
    }

    wasPlayingBeforeSeek.current = false;
  }, [startProgressLoop, startCursorSyncLoop]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const DialogTriggerContent = children ? (
    <div onClick={() => setCurrentOpenState(true)}>{children}</div>
  ) : null;

  return (
    <Dialog open={currentOpenState} onOpenChange={handleOpenChange}>
      {DialogTriggerContent && <DialogTrigger asChild>{DialogTriggerContent}</DialogTrigger>}
      <DialogContent
        className={cn(
          'w-full rounded-2xl flex flex-col',
          'max-w-lg md:max-w-4xl h-auto max-h-[90vh]'
        )}
      >
        <DialogHeader className="flex flex-row justify-between items-center">
          <DialogTitle>{tResults('playScore')}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </DialogHeader>

        <div ref={modalContainerRef} className="w-full flex-1 bg-white rounded-lg min-h-[40vh] overflow-y-auto overflow-x-hidden relative">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground z-10 bg-white/80 backdrop-blur-sm">
              <LoaderCircle className="h-8 w-8 animate-spin" />
              <p>Loading score...</p>
            </div>
          )}
          <div ref={modalBodyRef} className="w-full h-full"></div>
        </div>

        <DialogFooter className="flex-col sm:flex-col sm:justify-center gap-4 pt-4">
          <div className="sr-only">
            <DialogDescription>Interactive sheet music player.</DialogDescription>
          </div>
          <div className="flex items-center gap-4 w-full">
            <span className="text-xs font-mono">{formatTime(currentTime)}</span>
            <Slider
              value={[progress]}
              max={100}
              step={0.1}
              onValueChange={handleSeek}
              onPointerDown={handleSeekStart}
              onPointerUp={handleSeekEnd}
              disabled={isLoading || totalTime === 0}
            />
            <span className="text-xs font-mono">{formatTime(totalTime)}</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'rounded-full h-12 w-12',
                isLooping && 'bg-accent text-accent-foreground'
              )}
              onClick={handleLoopToggle}
              disabled={isLoading}
              title={isLooping ? t('cancelLoop') : t('loopPlay')}
            >
              <Repeat className="h-6 w-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-16 w-16"
              onClick={handlePlayPause}
              disabled={isLoading}
            >
              {isPlaying ? (
                <Pause className="h-8 w-8" />
              ) : (
                <Play className="h-8 w-8" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-12 w-12"
              onClick={handleStop}
              disabled={isLoading}
            >
              <Square className="h-6 w-6" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
