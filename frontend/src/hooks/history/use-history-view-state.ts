'use client';

import { useCallback, useState } from 'react';
import type { HistoryTab, HistoryView } from '@/components/history/history-types';

export interface HistoryTabState {
  page: number;
  searchQuery: string;
  sortBy: string;
  sortOrder: string;
  statusFilter: string;
  view: HistoryView;
}

const initialState: HistoryTabState = {
  page: 1,
  searchQuery: '',
  sortBy: 'created_at',
  sortOrder: 'desc',
  statusFilter: 'all',
  view: 'grid',
};

export function useHistoryViewState() {
  const [activeTab, setActiveTab] = useState<HistoryTab>('uploads');
  const [uploads, setUploads] = useState<HistoryTabState>(initialState);
  const [shares, setShares] = useState<HistoryTabState>(initialState);

  const updateTab = useCallback((tab: HistoryTab, patch: Partial<HistoryTabState>) => {
    const update = (current: HistoryTabState) => ({ ...current, ...patch });
    if (tab === 'uploads') setUploads(update);
    else setShares(update);
  }, []);

  const updateActive = useCallback(
    (patch: Partial<HistoryTabState>, resetPage = false) => {
      updateTab(activeTab, resetPage ? { ...patch, page: 1 } : patch);
    },
    [activeTab, updateTab]
  );

  return {
    activeTab,
    activeState: activeTab === 'uploads' ? uploads : shares,
    uploads,
    shares,
    setActiveTab,
    setPage: (tab: HistoryTab, page: number) => updateTab(tab, { page }),
    setSearchQuery: (searchQuery: string) => updateActive({ searchQuery }, true),
    setSort: (sortBy: string, sortOrder: string) => updateActive({ sortBy, sortOrder }, true),
    setStatusFilter: (statusFilter: string) => updateTab('uploads', { statusFilter, page: 1 }),
    setView: (view: HistoryView) => updateActive({ view, page: 1 }),
  };
}
