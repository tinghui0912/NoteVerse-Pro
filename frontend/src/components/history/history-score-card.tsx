'use client';

import Image from 'next/image';
import { Clock, Music } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { HistoryStatusIndicator } from './history-status-indicator';
import type { ShareHistoryItem, TaskHistoryItem } from './history-types';

interface HistoryScoreCardProps {
  item: TaskHistoryItem | ShareHistoryItem;
  isSelected: boolean;
  selectionMode: boolean;
  isUpload: boolean;
  onSelect: (id: string) => void;
  onOpen: () => void;
}

export function HistoryScoreCard({ item, isSelected, selectionMode, isUpload, onSelect, onOpen }: HistoryScoreCardProps) {
  const t = useTranslations('history');
  const tResults = useTranslations('results');
  const itemId = isUpload ? (item as TaskHistoryItem).id : String((item as ShareHistoryItem).id);

  return (
    <Card
      className={cn(
        'group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-xl',
        isSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
      )}
      onClick={() => (selectionMode ? onSelect(itemId) : onOpen())}
    >
      <div className={cn('absolute left-3 top-3 z-10', !selectionMode && 'hidden')}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onSelect(itemId)}
          className="h-5 w-5 bg-white/80 backdrop-blur-sm"
          onClick={(event) => event.stopPropagation()}
        />
      </div>
      <div className="relative aspect-4/3 bg-gray-100">
        {item.thumbnail ? (
          <Image src={item.thumbnail} alt={item.name} fill unoptimized className="object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : item.thumbnailError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Music className="h-8 w-8 text-gray-300" />
            <p className="mt-2 text-xs text-gray-400">{tResults('imageLoadFailed')}</p>
          </div>
        ) : (
          <div className="absolute inset-0 flex animate-pulse flex-col items-center justify-center">
            <Music className="h-8 w-8 text-gray-300" />
            <div className="mt-2 h-2 w-16 rounded bg-gray-200" />
          </div>
        )}
        {isUpload && (
          <div className="absolute right-2 top-2">
            <HistoryStatusIndicator status={(item as TaskHistoryItem).status} className="rounded-full bg-white/80 px-2 py-1 text-xs backdrop-blur-sm" />
          </div>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col justify-between p-4">
        <div>
          <h3 className="mb-1 truncate text-base font-semibold">{item.name}</h3>
          {isUpload ? (
            <p className="text-xs text-muted-foreground"><Clock className="mr-1 inline h-3 w-3" />{item.date}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('sharedByAt', { by: (item as ShareHistoryItem).sharedBy, date: item.date })}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
