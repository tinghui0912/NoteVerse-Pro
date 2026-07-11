'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Music } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ScoreCoverPlaybackButton } from '@/components/score-detail/score-cover-playback-button';
import { cn } from '@/lib/utils';

interface ScoreDetailHeroProps {
  title: string;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  playbackAudioSrc?: string;
  loadPlaybackXml?: () => Promise<string | null>;
  playbackEnabled?: boolean;
}

export function ScoreDetailHero({
  actions,
  loadPlaybackXml,
  meta,
  playbackAudioSrc,
  playbackEnabled = true,
  status,
  subtitle,
  thumbnailUrl,
  title,
}: ScoreDetailHeroProps) {
  const t = useTranslations('score');
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const showThumbnail = Boolean(thumbnailUrl && !thumbnailFailed);

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="relative h-56 overflow-hidden rounded-xl bg-muted md:h-60">
          {showThumbnail && thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={title}
              fill
              sizes="(min-width: 768px) 180px, 100vw"
              className="object-contain p-2"
              unoptimized
              onError={() => setThumbnailFailed(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Music className="h-12 w-12" />
            </div>
          )}
          {playbackEnabled ? (
            <ScoreCoverPlaybackButton
              audioSrc={playbackAudioSrc}
              loadXml={loadPlaybackXml}
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
            {status ? <div className="mt-4 flex flex-wrap gap-2">{status}</div> : null}
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
