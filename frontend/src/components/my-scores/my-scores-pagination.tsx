'use client';

import { Button } from '@/components/ui/button';

interface MyScoresPaginationProps {
  page: number;
  totalPages: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPageChange: (page: number) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function MyScoresPagination({
  page,
  totalPages,
  canGoPrevious,
  canGoNext,
  onPageChange,
  t,
}: MyScoresPaginationProps) {
  return (
    <div className="mt-8 flex flex-col items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row">
      <p className="text-sm text-muted-foreground">
        {t('pagination', { page, totalPages })}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!canGoPrevious}
          onClick={() => onPageChange(page - 1)}
        >
          {t('previousPage')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canGoNext}
          onClick={() => onPageChange(page + 1)}
        >
          {t('nextPage')}
        </Button>
      </div>
    </div>
  );
}
