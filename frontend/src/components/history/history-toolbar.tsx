'use client';

import { Download, Edit, LayoutGrid, List, Loader2, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { HistoryTab, HistoryView } from './history-types';

interface HistoryToolbarProps {
  activeTab: HistoryTab;
  searchQuery: string;
  sortBy: string;
  sortOrder: string;
  statusFilter: string;
  view: HistoryView;
  selectionMode: boolean;
  selectedCount: number;
  isAllSelected: boolean;
  isDeleting: boolean;
  isDownloading: boolean;
  onSearchChange: (value: string) => void;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  onStatusChange: (value: string) => void;
  onViewChange: (value: HistoryView) => void;
  onSelectAll: (checked: boolean) => void;
  onToggleSelection: () => void;
  onBatchDelete: () => void;
  onBatchDownload: () => void;
}

export function HistoryToolbar(props: HistoryToolbarProps) {
  const t = useTranslations('history');
  const common = useTranslations('common');

  if (props.selectionMode) {
    return (
      <div className="flex w-full flex-wrap items-center gap-4">
        <Checkbox checked={props.isAllSelected} onCheckedChange={(checked) => props.onSelectAll(Boolean(checked))} aria-label={common('selectAll')} className="h-5 w-5" />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {props.selectedCount > 0 ? t('selectedCount', { count: props.selectedCount }) : common('selectAll')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={props.selectedCount === 0 || props.isDownloading} onClick={props.onBatchDownload}>
            {props.isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{t('batchDownload')}
          </Button>
          <Button variant="destructive" size="sm" disabled={props.selectedCount === 0 || props.isDeleting} onClick={props.onBatchDelete}>
            {props.isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}{t('batchDelete')}
          </Button>
          <Button variant="ghost" onClick={props.onToggleSelection}>{common('done')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="relative w-full">
        <Input placeholder={t('searchPlaceholder')} className="h-12 bg-white pl-10" value={props.searchQuery} onChange={(event) => props.onSearchChange(event.target.value)} />
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 md:flex-nowrap">
        <div className="flex w-full flex-col items-center gap-4 md:w-auto md:flex-row">
          <Select
            value={`${props.sortBy === 'title' ? 'name' : 'date'}_${props.sortOrder}`}
            onValueChange={(value) => {
              const [field, order] = value.split('_');
              props.onSortChange(field === 'name' ? 'title' : 'created_at', order);
            }}
          >
            <SelectTrigger id={`sort-${props.activeTab}`} className="h-12 w-full bg-white md:w-45"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">{t('sortDateDesc')}</SelectItem>
              <SelectItem value="date_asc">{t('sortDateAsc')}</SelectItem>
              <SelectItem value="name_asc">{t('sortNameAsc')}</SelectItem>
              <SelectItem value="name_desc">{t('sortNameDesc')}</SelectItem>
            </SelectContent>
          </Select>
          {props.activeTab === 'uploads' && (
            <Select value={props.statusFilter} onValueChange={props.onStatusChange}>
              <SelectTrigger id="status-uploads" className="h-12 w-full bg-white md:w-45"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filterAll')}</SelectItem>
                <SelectItem value="completed">{t('statusCompleted')}</SelectItem>
                <SelectItem value="pending-review">{t('statusPendingReview')}</SelectItem>
                <SelectItem value="in-progress">{t('statusInProgress')}</SelectItem>
                <SelectItem value="queued">{t('statusQueued')}</SelectItem>
                <SelectItem value="failed">{t('statusFailed')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={props.onToggleSelection} className="h-12 bg-white"><Edit className="mr-2 h-4 w-4" />{common('edit')}</Button>
          <div className="flex items-center justify-center gap-1 rounded-lg border bg-white p-1 shadow-sm">
            <Button aria-label="List view" variant={props.view === 'list' ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10" onClick={() => props.onViewChange('list')}><List className="h-5 w-5" /></Button>
            <Button aria-label="Grid view" variant={props.view === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10" onClick={() => props.onViewChange('grid')}><LayoutGrid className="h-5 w-5" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}
