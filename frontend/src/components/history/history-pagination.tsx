'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function HistoryPagination({ currentPage, pageCount, onPageChange }: { currentPage: number; pageCount: number; onPageChange: (page: number) => void }) {
  const t = useTranslations('common');
  if (pageCount <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>{t('prevPage')}</Button>
      <span className="text-sm text-muted-foreground">{t('pageInfo', { current: String(currentPage), total: String(pageCount) })}</span>
      <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === pageCount}>{t('nextPage')}</Button>
    </div>
  );
}
