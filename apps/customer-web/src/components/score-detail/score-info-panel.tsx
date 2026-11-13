'use client';

import { useEffect, useRef, useState } from 'react';
import { Edit, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useScoreCapabilities } from '@/components/score/score-capability-context';
import { useUpdateScore } from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { formatApiDateTime } from '@/lib/date-time';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { formatKeySignature } from '@/lib/score/metadata-display';
import {
  SCORE_GENRE_LABEL_KEYS,
  scoreGenresForDisplay,
  knownGenres,
  isScoreGenre,
} from '@/lib/score/genres';
import type { MetadataRead, ScoreGenre } from '@/generated/api';

interface ScoreInfoPanelProps {
  canEditTitle?: boolean;
  createdAt?: string | null;
  imageCount: number;
  imageCountStatus?: 'pending' | 'processing' | 'ready' | 'unavailable';
  metadata?: MetadataRead | null;
  scoreId?: string;
  genres: ScoreGenre[];
  title: string;
  updatedAt?: string | null;
  version?: number;
}

export function ScoreInfoPanel({
  canEditTitle = false,
  createdAt,
  imageCount,
  imageCountStatus = 'ready',
  metadata,
  scoreId,
  genres,
  title: currentTitle,
  updatedAt,
  version = 1,
}: ScoreInfoPanelProps) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const scoreStyles = useTranslations('scoreStyles.genre');
  const locale = useLocale();
  const { toast } = useToast();
  const mutation = useUpdateScore();
  const { capabilities } = useScoreCapabilities();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canEditStyles = Boolean(scoreId && capabilities.can_edit);
  const [title, setTitle] = useState(currentTitle);
  const [editing, setEditing] = useState(false);

  const serverGenres = knownGenres(genres);
  const serverKey = serverGenres.join('|');
  const [optimistic, setOptimistic] = useState<{
    serverKey: string;
    genres: ScoreGenre[];
  } | null>(null);
  const selectedGenres = optimistic?.serverKey === serverKey ? optimistic.genres : serverGenres;
  const selectedKeys = new Set(selectedGenres);
  const availableGenres = scoreGenresForDisplay.filter((tag) => !selectedKeys.has(tag));
  const imageCountLabel =
    imageCountStatus === 'pending' || imageCountStatus === 'processing' ? (
      <span
        aria-label={t('totalPages')}
        className="inline-block h-4 w-12 animate-pulse rounded bg-muted"
      />
    ) : imageCountStatus === 'unavailable' ? (
      '-'
    ) : (
      t('pageCount', { count: imageCount })
    );

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const saveTitle = () => {
    if (!scoreId || !editing) return;
    const nextTitle = title.trim();
    if (nextTitle === currentTitle) {
      setEditing(false);
      return;
    }
    if (!nextTitle) {
      toast({
        variant: 'destructive',
        title: t('nameEmptyTitle'),
        description: t('nameEmptyDesc'),
      });
      setTitle(currentTitle);
      setEditing(false);
      return;
    }
    mutation.mutate(
      { scoreId, title: nextTitle, expected_version: version },
      {
        onSuccess: () => {
          toast({ title: t('saveSuccess'), description: t('scoreInfoUpdated') });
          setEditing(false);
        },
        onError: (error) =>
          toast({
            variant: 'destructive',
            title: t('saveFailed'),
            description: userFacingErrorMessage(errors, error, t('saveFailedDesc')),
          }),
      }
    );
  };

  const saveGenres = (nextGenres: ScoreGenre[]) => {
    if (!scoreId || mutation.isPending) return;
    const previousGenres = selectedGenres;
    setOptimistic({ serverKey, genres: nextGenres });
    mutation.mutate(
      {
        scoreId,
        genres: knownGenres(nextGenres),
        expected_version: version,
      },
      {
        onSuccess: () => toast({ title: t('saveSuccess'), description: t('styleTagsUpdated') }),
        onError: (error) => {
          setOptimistic({ serverKey, genres: previousGenres });
          toast({
            variant: 'destructive',
            title: t('saveFailed'),
            description: userFacingErrorMessage(errors, error, t('saveFailedDesc')),
          });
        },
      }
    );
  };

  const addGenre = (code: string) => {
    if (!isScoreGenre(code) || selectedKeys.has(code)) return;
    saveGenres([...selectedGenres, code]);
  };

  const removeGenre = (tag: ScoreGenre) => {
    saveGenres(selectedGenres.filter((item) => item !== tag));
  };

  return (
    <Card className="rounded-2xl bg-white shadow-sm" data-testid="score-info-panel">
      <CardHeader>
        <CardTitle>{t('scoreInfo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="score-title" className="text-muted-foreground">
              {t('scoreName')}
            </Label>
            {editing ? (
              <Input
                ref={inputRef}
                id="score-title"
                value={title}
                onBlur={saveTitle}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    setTitle(currentTitle);
                    setEditing(false);
                  }
                }}
                maxLength={30}
                disabled={mutation.isPending}
              />
            ) : (
              <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border bg-muted/30 px-3">
                <span className="truncate font-medium">{currentTitle}</span>
                {canEditTitle && scoreId ? (
                  <Button
                    aria-label={common('edit')}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    onClick={() => {
                      setTitle(currentTitle);
                      setEditing(true);
                    }}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? <InlineLoading /> : <Edit className="h-4 w-4" />}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <span className="text-sm text-muted-foreground">{t('keySignature')}</span>
            <div className="min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-medium">
              {formatKeySignature(metadata?.primary_key_fifths, metadata?.primary_mode)}
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-sm text-muted-foreground">{t('measureCount')}</span>
            <div className="min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-medium">
              {metadata?.measure_count ?? '-'}
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-sm text-muted-foreground">{t('totalPages')}</span>
            <div className="min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-medium">
              {imageCountLabel}
            </div>
          </div>
          {createdAt ? (
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">{t('uploadTime')}</span>
              <time
                dateTime={createdAt}
                className="block min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-medium"
              >
                {formatApiDateTime(createdAt, locale)}
              </time>
            </div>
          ) : null}
          {updatedAt ? (
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">{t('lastModifiedTime')}</span>
              <time
                dateTime={updatedAt}
                className="block min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-medium"
              >
                {formatApiDateTime(updatedAt, locale)}
              </time>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 border-t pt-5">
          <Label>{t('scoreStyles')}</Label>
          <div className="flex flex-wrap gap-2">
            {selectedGenres.length > 0 ? (
              selectedGenres.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700"
                >
                  {scoreStyles(SCORE_GENRE_LABEL_KEYS[tag])}
                  {canEditStyles ? (
                    <button
                      type="button"
                      onClick={() => removeGenre(tag)}
                      disabled={mutation.isPending}
                      aria-label={t('removeStyleTag', {
                        name: scoreStyles(SCORE_GENRE_LABEL_KEYS[tag]),
                      })}
                      className="rounded-full p-0.5 hover:bg-orange-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t('noStyleTags')}</p>
            )}
          </div>
          {canEditStyles ? (
            <div className="flex gap-2">
              <Select
                onValueChange={addGenre}
                disabled={mutation.isPending || availableGenres.length === 0}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder={t('addStyleTagPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {availableGenres.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {scoreStyles(SCORE_GENRE_LABEL_KEYS[tag])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending || selectedGenres.length === 0}
                onClick={() => saveGenres([])}
              >
                {t('clearStyleTags')}
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
