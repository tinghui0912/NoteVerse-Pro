'use client';

import { Music } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ScoreThumbnailProps {
  title: string;
  thumbnailRenderAssetId?: string | null;
  className?: string;
}

export function ScoreThumbnail({
  title,
  thumbnailRenderAssetId,
  className,
}: ScoreThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const src =
    thumbnailRenderAssetId && !failed
      ? `/api/v1/render-assets/${encodeURIComponent(thumbnailRenderAssetId)}/download`
      : null;

  return (
    <div
      className={cn(
        'relative flex h-32 items-center justify-center overflow-hidden rounded-xl bg-muted',
        className
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={title}
          fill
          sizes="(min-width: 1024px) 280px, 50vw"
          className="object-contain p-2"
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <Music className="h-10 w-10 text-muted-foreground" />
      )}
    </div>
  );
}
