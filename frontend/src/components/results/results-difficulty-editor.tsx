'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useUpdateTask } from '@/hooks/queries/use-task-queries';
import { useToast } from '@/hooks/use-toast';

const difficultyOptions = [
  'difficultyBeginner',
  'difficultyIntermediate',
  'difficultyAdvanced',
] as const;

export function ResultsDifficultyEditor({
  difficulty,
  taskId,
}: {
  difficulty?: string;
  taskId: string;
}) {
  const t = useTranslations('results');
  const upload = useTranslations('upload');
  const mutation = useUpdateTask();
  const { toast } = useToast();
  const serverDifficulty = difficulty ?? '';
  const [optimisticDifficulty, setOptimisticDifficulty] = useState<{
    serverValue: string;
    value: string;
  } | null>(null);
  const selectedDifficulty = optimisticDifficulty?.serverValue === serverDifficulty
    ? optimisticDifficulty.value
    : serverDifficulty;

  const updateDifficulty = (nextDifficulty: string) => {
    if (!nextDifficulty || nextDifficulty === selectedDifficulty || mutation.isPending) {
      return;
    }
    const previousDifficulty = selectedDifficulty;
    setOptimisticDifficulty({ serverValue: serverDifficulty, value: nextDifficulty });
    mutation.mutate(
      { id: taskId, data: { difficulty: nextDifficulty } },
      {
        onSuccess: () => {
          toast({ title: t('saveSuccess'), description: t('scoreInfoUpdated') });
        },
        onError: (error) => toast({
          variant: 'destructive',
          title: t('saveFailed'),
          description: error instanceof Error ? error.message : t('saveFailedDesc'),
        }),
        onSettled: (_data, error) => {
          if (error) {
            setOptimisticDifficulty({ serverValue: serverDifficulty, value: previousDifficulty });
          }
        },
      }
    );
  };

  return (
    <Card className="rounded-2xl bg-white shadow-lg" data-testid="results-difficulty">
      <CardHeader>
        <CardTitle>{t('scoreDifficulty')}</CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={selectedDifficulty}
          onValueChange={updateDifficulty}
          disabled={mutation.isPending}
        >
          {difficultyOptions.map((option) => (
            <div key={option} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <RadioGroupItem id={`score-${option}`} value={option} />
              <Label htmlFor={`score-${option}`} className="flex-1 font-normal">
                {upload(option)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
