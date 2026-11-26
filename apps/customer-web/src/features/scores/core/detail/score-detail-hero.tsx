'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Loader2, Music } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ScoreCoverPlaybackButton } from '@/features/scores/core/detail/score-cover-playback-button';
import { cn } from '@/lib/utils';

interface ScoreDetailHeroProps {
  title: string;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  thumbnailLoading?: boolean;
  meta?: ReactNode;
  actions?: ReactNode;
  loadPlayback?: () => Promise<{ playback_url: string; expires_in: number }>;
  playbackIdentity?: string;
  playbackEnabled?: boolean;
  playbackLoading?: boolean;
  playbackVisible?: boolean;
}

export function ScoreDetailHero({
  actions,
  meta,
  loadPlayback,
  playbackIdentity,
  playbackEnabled = true,
  playbackLoading = false,
  playbackVisible,
  subtitle,
  thumbnailUrl,
  thumbnailLoading = false,
  title,
}: ScoreDetailHeroProps) {
  const t = useTranslations('score');
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);
  const showThumbnail = Boolean(thumbnailUrl && thumbnailUrl !== failedThumbnailUrl);
  const showPlaybackButton = playbackVisible ?? playbackEnabled;

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="relative h-56 overflow-hidden rounded-xl bg-muted md:h-60">
          {showThumbnail && thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={title}
              fill
              priority
              loading="eager"
              sizes="(min-width: 768px) 180px, 100vw"
              className="object-contain p-2"
              unoptimized
              onError={() => setFailedThumbnailUrl(thumbnailUrl)}
            />
          ) : (
            <div role="img" aria-label={title} className="flex h-full items-center justify-center text-muted-foreground">
              {thumbnailLoading ? <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin" /> : <Music aria-hidden="true" className="h-12 w-12" />}
            </div>
          )}
          {showPlaybackButton ? (
            <ScoreCoverPlaybackButton
              key={playbackIdentity}
              loadPlayback={loadPlayback}
              disabled={!playbackEnabled || !loadPlayback}
              loading={playbackLoading}
              className="absolute bottom-3 left-3"
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 truncate text-base text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {actions ? (
            <div className={cn('mt-6 flex flex-wrap items-center gap-3')}>
              {actions}
            </div>
          ) : null}
          {meta ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {meta}
            </div>
          ) : (
            <span className="sr-only">{t('scoreInfo')}</span>
          )}
        </div>
      </div>
    </section>
  );
}
