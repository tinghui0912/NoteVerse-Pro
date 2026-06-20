'use client';

import { useState } from 'react';
import { Edit, Loader2, Save, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useUpdateTask } from '@/hooks/queries/use-task-queries';
import type { Task } from '@/types/api';

export function ResultsMetadataEditor({ taskId, task, parsedTitle }: { taskId: string; task?: Task; parsedTitle: string }) {
  const t = useTranslations('results');
  const common = useTranslations('common');
  const upload = useTranslations('upload');
  const { toast } = useToast();
  const mutation = useUpdateTask();
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [editing, setEditing] = useState(false);

  const displayTitle = editing ? title : task?.title || parsedTitle || '';
  const displayDifficulty = editing ? difficulty : task?.difficulty || '';

  const cancel = () => {
    setEditing(false);
  };

  const toggle = () => {
    if (!editing) {
      setTitle(task?.title || parsedTitle || '');
      setDifficulty(task?.difficulty || '');
      setEditing(true);
      return;
    }
    if (!title.trim()) {
      toast({ variant: 'destructive', title: t('nameEmptyTitle'), description: t('nameEmptyDesc') });
      return;
    }
    mutation.mutate(
      { id: taskId, data: { title, difficulty } },
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

  return (
    <Card className="rounded-2xl bg-white shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('scoreInfo')}</CardTitle>
        <div className="flex gap-1">
          {editing && <Button aria-label={common('cancel')} variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={cancel}><X className="h-4 w-4" /></Button>}
          <Button aria-label={editing ? t('saveSuccess') : common('edit')} variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={toggle} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Save className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 text-sm">
          <Label htmlFor="score-title" className="shrink-0 text-muted-foreground">{t('scoreName')}</Label>
          {editing ? <Input id="score-title" value={displayTitle} onChange={(event) => setTitle(event.target.value)} maxLength={30} className="h-8 min-w-0 flex-1 bg-white text-sm" /> : <span className="flex-1 truncate text-right text-sm font-medium">{displayTitle}</span>}
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <Label className="shrink-0 text-muted-foreground">{t('scoreDifficulty')}</Label>
          {editing ? (
            <Select value={displayDifficulty} onValueChange={setDifficulty}>
              <SelectTrigger className="h-8 min-w-0 flex-1 gap-1 bg-white text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="difficultyBeginner">{upload('difficultyBeginner')}</SelectItem>
                <SelectItem value="difficultyIntermediate">{upload('difficultyIntermediate')}</SelectItem>
                <SelectItem value="difficultyAdvanced">{upload('difficultyAdvanced')}</SelectItem>
              </SelectContent>
            </Select>
          ) : <span className="flex-1 truncate text-right text-sm font-medium">{displayDifficulty ? upload(displayDifficulty as never) : ''}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
