'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { useScoreShell } from '@/components/score-shell/score-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateScore } from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import {
  SCORE_GENRE_TAGS,
  taxonomyTagKey,
  type ScoreTaxonomyTagValue,
} from '@/lib/score/taxonomy';
import type { ScoreTaxonomyTag } from '@/types/api';

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

export function ScoreStyleTagsEditor({
  taxonomyTags,
  scoreId,
  version,
}: {
  taxonomyTags: ScoreTaxonomyTag[];
  scoreId: string;
  version: number;
}) {
  const t = useTranslations('score');
  const scoreStyles = useTranslations('scoreStyles.genre');
  const errors = useTranslations('errors');
  const mutation = useUpdateScore();
  const { toast } = useToast();
  const { capabilities } = useScoreShell();
  const canEdit = capabilities.can_edit;
  const serverTags = normalizeGenreTags(taxonomyTags);
  const serverKey = serverTags.map(taxonomyTagKey).join('|');
  const [optimistic, setOptimistic] = useState<{
    serverKey: string;
    tags: ScoreTaxonomyTagValue[];
  } | null>(null);
  const selectedTags = optimistic?.serverKey === serverKey ? optimistic.tags : serverTags;
  const selectedKeys = new Set(selectedTags.map(taxonomyTagKey));
  const availableTags = SCORE_GENRE_TAGS.filter((tag) => !selectedKeys.has(taxonomyTagKey(tag)));

  const saveTags = (nextTags: ScoreTaxonomyTagValue[]) => {
    if (mutation.isPending) return;
    const previousTags = selectedTags;
    setOptimistic({ serverKey, tags: nextTags });
    mutation.mutate(
      {
        scoreId,
        taxonomy_tags: nextTags.map((tag) => ({ category: tag.category, code: tag.code })),
        expected_version: version,
      },
      {
        onSuccess: () => {
          toast({ title: t('saveSuccess'), description: t('styleTagsUpdated') });
        },
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
    <Card className="rounded-2xl bg-white shadow-lg" data-testid="score-style-tags">
      <CardHeader>
        <CardTitle>{t('scoreStyles')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {selectedTags.length > 0 ? selectedTags.map((tag) => (
            <span
              key={taxonomyTagKey(tag)}
              className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700"
            >
              {scoreStyles(tag.code)}
              {canEdit ? (
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
        {canEdit ? <div className="flex gap-2">
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
        </div> : null}
      </CardContent>
    </Card>
  );
}
