'use client';

import { Pause, Play, Repeat, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface ScorePreviewControlsProps {
  currentTime: number;
  isLoading: boolean;
  isLooping: boolean;
  isPlaying: boolean;
  progress: number;
  totalTime: number;
  onPlayPause: () => void | Promise<void>;
  onSeek: (value: number[]) => void;
  onSeekEnd: () => void | Promise<void>;
  onSeekStart: () => void;
  onStop: () => void | Promise<void>;
  onToggleLoop: () => void;
}

export function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function ScorePreviewControls(props: ScorePreviewControlsProps) {
  const t = useTranslations('common');
  return (
    <>
      <div className="flex items-center gap-4 w-full">
        <span className="text-xs font-mono">{formatPlaybackTime(props.currentTime)}</span>
        <Slider
          value={[props.progress]}
          max={100}
          step={0.1}
          onValueChange={props.onSeek}
          onPointerDown={props.onSeekStart}
          onPointerUp={() => void props.onSeekEnd()}
          disabled={props.isLoading || props.totalTime === 0}
        />
        <span className="text-xs font-mono">{formatPlaybackTime(props.totalTime)}</span>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className={cn('rounded-full h-12 w-12', props.isLooping && 'bg-accent text-accent-foreground')}
          onClick={props.onToggleLoop}
          disabled={props.isLoading}
          title={props.isLooping ? t('cancelLoop') : t('loopPlay')}
        >
          <Repeat className="h-6 w-6" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full h-16 w-16"
          onClick={() => void props.onPlayPause()}
          disabled={props.isLoading}
        >
          {props.isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full h-12 w-12"
          onClick={() => void props.onStop()}
          disabled={props.isLoading}
        >
          <Square className="h-6 w-6" />
        </Button>
      </div>
    </>
  );
}
