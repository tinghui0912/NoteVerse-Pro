'use client';

import { useEffect, useRef, useState } from 'react';
import { Edit, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useScoreShell } from '@/components/score-shell/score-shell';
import { useToast } from '@/hooks/use-toast';
import { useUpdateScore } from '@/hooks/queries/use-score-queries';
import { formatApiDateTime, formatKeySignature } from '@/lib/score/metadata-display';
import type { ScoreDetail } from '@/types/api';

interface ScoreMetadataEditorProps {
  imageCount: number;
  parsedTitle: string;
  score?: ScoreDetail;
  scoreId: string;
}

export function ScoreMetadataEditor({
  imageCount,
  parsedTitle,
  score,
  scoreId,
}: ScoreMetadataEditorProps) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const locale = useLocale();
  const { toast } = useToast();
  const mutation = useUpdateScore();
  const { capabilities } = useScoreShell();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canEdit = capabilities.can_edit;
  const currentTitle = score?.title || parsedTitle || '';
  const [title, setTitle] = useState(currentTitle);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const saveTitle = () => {
    const nextTitle = title.trim();
    if (!editing) return;
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
      { scoreId, title: nextTitle, expected_version: score?.version ?? 1 },
      {
        onSuccess: () => {
          toast({ title: t('saveSuccess'), description: t('scoreInfoUpdated') });
          setEditing(false);
        },
        onError: (error) => toast({
          variant: 'destructive',
          title: t('saveFailed'),
          description: error instanceof Error ? error.message : t('saveFailedDesc'),
        }),
      }
    );
  };

  const startEditing = () => {
    setTitle(currentTitle);
    setEditing(true);
  };

  return (
    <Card className="rounded-2xl bg-white shadow-lg" data-testid="score-metadata">
      <CardHeader>
        <CardTitle>{t('scoreInfo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 text-sm">
          <Label htmlFor="score-title" className="shrink-0 text-muted-foreground">{t('scoreName')}</Label>
          {editing ? (
            <Input
              ref={inputRef}
              id="score-title"
              value={title}
              onBlur={saveTitle}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setTitle(currentTitle);
                  setEditing(false);
                }
              }}
              maxLength={30}
              className="h-8 min-w-0 flex-1 bg-white text-sm"
              disabled={mutation.isPending}
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <span className="truncate text-right text-sm font-medium">{currentTitle}</span>
              {canEdit ? (
                <Button
                  aria-label={common('edit')}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                  onClick={startEditing}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit className="h-4 w-4" />}
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t('keySignature')}</span>
          <span className="font-medium">
            {formatKeySignature(score?.metadata?.primary_key_fifths, score?.metadata?.primary_mode)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t('measureCount')}</span>
          <span className="font-medium">{score?.metadata?.measure_count ?? '-'}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t('totalPages')}</span>
          <span className="font-medium">{t('pageCount', { count: imageCount })}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t('uploadTime')}</span>
          <time dateTime={score?.created_at} className="text-right font-medium">
            {formatApiDateTime(score?.created_at, locale)}
          </time>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t('lastModifiedTime')}</span>
          <time dateTime={score?.updated_at} className="text-right font-medium">
            {formatApiDateTime(score?.updated_at, locale)}
          </time>
        </div>
      </CardContent>
    </Card>
  );
}
