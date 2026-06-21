'use client';

import type { ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ScorePreviewControls } from './score-preview-controls';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useScorePreviewPlayback } from '@/hooks/score/use-score-preview-playback';
import { cn } from '@/lib/utils';

interface ListenModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  xmlString: string | null;
  children?: ReactNode;
}

export function ListenModal({ isOpen, onOpenChange, xmlString, children }: ListenModalProps) {
  const t = useTranslations('common');
  const tResults = useTranslations('results');
  const playback = useScorePreviewPlayback({ isOpen, xmlString });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {children ? <DialogTrigger asChild><div onClick={() => onOpenChange(true)}>{children}</div></DialogTrigger> : null}
      <DialogContent className={cn('w-full rounded-2xl flex flex-col', 'max-w-lg md:max-w-4xl h-auto max-h-[90vh]')}>
        <style jsx global>{`
          .verovio-preview-page {
            margin: 0 auto 1.5rem;
            overflow: hidden;
            border: 1px solid #e7e5e4;
            border-radius: 0.75rem;
            background: white;
          }
          .verovio-preview-page svg {
            display: block;
            width: 100% !important;
            height: auto;
          }
          .verovio-preview-page .score-playback-active,
          .verovio-preview-page .score-playback-active path,
          .verovio-preview-page .score-playback-active use,
          .verovio-preview-page .score-playback-active ellipse {
            fill: #f97316 !important;
            stroke: #ea580c !important;
          }
        `}</style>
        <DialogHeader className="flex flex-row justify-between items-center">
          <DialogTitle>{tResults('playScore')}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              <span className="sr-only">{t('cancel')}</span>
            </Button>
          </DialogClose>
        </DialogHeader>

        <div ref={playback.containerRef} className="w-full flex-1 bg-white rounded-lg min-h-[40vh] overflow-y-auto overflow-x-hidden relative">
          {playback.isLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground z-10 bg-white/80 backdrop-blur-sm">
              <LoaderCircle className="h-8 w-8 animate-spin" />
              <p>{t('loadingScoreData')}</p>
            </div>
          ) : null}
          {playback.loadError ? (
            <div role="alert" className="absolute inset-0 z-10 flex items-center justify-center bg-white p-6 text-center text-destructive">
              <p>{playback.loadError}</p>
            </div>
          ) : null}
          <div ref={playback.scoreContainerRef} className="w-full h-full" />
        </div>

        <DialogFooter className="flex-col sm:flex-col sm:justify-center gap-4 pt-4">
          <div className="sr-only"><DialogDescription>{tResults('playScore')}</DialogDescription></div>
          <ScorePreviewControls
            currentTime={playback.currentTime}
            isLoading={playback.isLoading}
            isLooping={playback.isLooping}
            isPlaying={playback.isPlaying}
            progress={playback.progress}
            totalTime={playback.totalTime}
            onPlayPause={playback.playPause}
            onSeek={playback.seek}
            onSeekEnd={playback.seekEnd}
            onSeekStart={playback.seekStart}
            onStop={playback.stop}
            onToggleLoop={playback.toggleLoop}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
