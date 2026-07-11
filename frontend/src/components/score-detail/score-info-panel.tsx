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
import { ApiError } from '@/lib/api-client';
import { formatApiDateTime } from '@/lib/date-time';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { formatKeySignature } from '@/lib/score/metadata-display';
import {
  SCORE_GENRE_TAGS,
  taxonomyTagKey,
  type ScoreTaxonomyTagValue,
} from '@/lib/score/taxonomy';
import type { ScoreMetadata, ScoreTaxonomyTag } from '@/types/api';

interface ScoreInfoPanelProps {
  canEditTitle?: boolean;
  createdAt?: string | null;
  imageCount: number;
  metadata?: ScoreMetadata | null;
  scoreId?: string;
  taxonomyTags: ScoreTaxonomyTag[];
  title: string;
  updatedAt?: string | null;
  version?: number;
}

function normalizeGenreTags(tags: ScoreTaxonomyTag[] | ScoreTaxonomyTagValue[]) {
  const keys = new Set<string>();
  const result: ScoreTaxonomyTagValue[] = [];
  for (const tag of tags) {
    const match = SCORE_GENRE_TAGS.find(
      (item) => item.category === tag.category && item.code === tag.code
    );
    if (!match) continue;
    const key = taxonomyTagKey(match);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(match);
  }
  return result;
}

export function ScoreInfoPanel({
  canEditTitle = false,
  createdAt,
  imageCount,
  metadata,
  scoreId,
  taxonomyTags,
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

  const serverTags = normalizeGenreTags(taxonomyTags);
  const serverKey = serverTags.map(taxonomyTagKey).join('|');
  const [optimistic, setOptimistic] = useState<{
    serverKey: string;
    tags: ScoreTaxonomyTagValue[];
  } | null>(null);
  const selectedTags = optimistic?.serverKey === serverKey ? optimistic.tags : serverTags;
  const selectedKeys = new Set(selectedTags.map(taxonomyTagKey));
  const availableTags = SCORE_GENRE_TAGS.filter((tag) => !selectedKeys.has(taxonomyTagKey(tag)));

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
      toast({ variant: 'destructive', title: t('nameEmptyTitle'), description: t('nameEmptyDesc') });
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
        onError: (error) => toast({
          variant: 'destructive',
          title: t('saveFailed'),
          description: error instanceof ApiError
            ? translateErrorCode(errors, error.code, t('saveFailedDesc'))
            : t('saveFailedDesc'),
        }),
      }
    );
  };

  const saveTags = (nextTags: ScoreTaxonomyTagValue[]) => {
    if (!scoreId || mutation.isPending) return;
    const previousTags = selectedTags;
    setOptimistic({ serverKey, tags: nextTags });
    mutation.mutate(
      {
        scoreId,
        taxonomy_tags: nextTags.map((tag) => ({ category: tag.category, code: tag.code })),
        expected_version: version,
      },
      {
        onSuccess: () => toast({ title: t('saveSuccess'), description: t('styleTagsUpdated') }),
        onError: (error) => {
          setOptimistic({ serverKey, tags: previousTags });
          toast({
            variant: 'destructive',
            title: t('saveFailed'),
            description: error instanceof ApiError
              ? translateErrorCode(errors, error.code, t('saveFailedDesc'))
              : t('saveFailedDesc'),
          });
        },
      }
    );
  };

  const addTag = (code: string) => {
    const tag = SCORE_GENRE_TAGS.find((item) => item.code === code);
    if (!tag || selectedKeys.has(taxonomyTagKey(tag))) return;
    saveTags([...selectedTags, tag]);
  };

  const removeTag = (tag: ScoreTaxonomyTagValue) => {
    saveTags(selectedTags.filter((item) => taxonomyTagKey(item) !== taxonomyTagKey(tag)));
  };

  return (
    <Card className="rounded-2xl bg-white shadow-sm" data-testid="score-info-panel">
      <CardHeader>
        <CardTitle>{t('scoreInfo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="score-title" className="text-muted-foreground">{t('scoreName')}</Label>
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
              {t('pageCount', { count: imageCount })}
            </div>
          </div>
          {createdAt ? (
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">{t('uploadTime')}</span>
              <time dateTime={createdAt} className="block min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-medium">
                {formatApiDateTime(createdAt, locale)}
              </time>
            </div>
          ) : null}
          {updatedAt ? (
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">{t('lastModifiedTime')}</span>
              <time dateTime={updatedAt} className="block min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-medium">
                {formatApiDateTime(updatedAt, locale)}
              </time>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 border-t pt-5">
          <Label>{t('scoreStyles')}</Label>
          <div className="flex flex-wrap gap-2">
            {selectedTags.length > 0 ? selectedTags.map((tag) => (
              <span
                key={taxonomyTagKey(tag)}
                className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700"
              >
                {scoreStyles(tag.code)}
                {canEditStyles ? (
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    disabled={mutation.isPending}
                    aria-label={t('removeStyleTag', { name: scoreStyles(tag.code) })}
                    className="rounded-full p-0.5 hover:bg-orange-100 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            )) : (
              <p className="text-sm text-muted-foreground">{t('noStyleTags')}</p>
            )}
          </div>
          {canEditStyles ? (
            <div className="flex gap-2">
              <Select onValueChange={addTag} disabled={mutation.isPending || availableTags.length === 0}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder={t('addStyleTagPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {availableTags.map((tag) => (
                    <SelectItem key={taxonomyTagKey(tag)} value={tag.code}>
                      {scoreStyles(tag.code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending || selectedTags.length === 0}
                onClick={() => saveTags([])}
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
