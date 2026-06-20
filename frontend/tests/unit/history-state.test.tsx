// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getTaskLink, mapStatusToTaskState, mapTaskStateToStatus } from '@/components/history/history-types';
import { useHistorySelection } from '@/hooks/history/use-history-selection';
import { useHistoryViewState } from '@/hooks/history/use-history-view-state';

describe('history state boundaries', () => {
  it('keeps filters and pagination independent between tabs', () => {
    const { result } = renderHook(() => useHistoryViewState());

    act(() => {
      result.current.setSearchQuery('upload');
      result.current.setStatusFilter('completed');
      result.current.setPage('uploads', 3);
      result.current.setActiveTab('shares');
    });
    act(() => {
      result.current.setSearchQuery('shared');
      result.current.setPage('shares', 2);
    });

    expect(result.current.uploads).toMatchObject({ page: 3, searchQuery: 'upload', statusFilter: 'completed' });
    expect(result.current.shares).toMatchObject({ page: 2, searchQuery: 'shared', statusFilter: 'all' });
  });

  it('clears selection and exits selection mode at a tab boundary', () => {
    const { result } = renderHook(() => useHistorySelection(['a', 'b']));
    act(() => {
      result.current.toggleMode();
      result.current.toggleItem('a');
    });
    expect(result.current.selectedItems).toEqual(['a']);

    act(() => result.current.clear());
    expect(result.current.selectedItems).toEqual([]);
    expect(result.current.selectionMode).toBe(false);
  });
});

describe('history task mapping', () => {
  it('maps backend states and routes consistently', () => {
    expect(mapTaskStateToStatus('PENDING_REVIEW')).toBe('pending-review');
    expect(mapStatusToTaskState('completed')).toBe('SUCCESS');
    expect(getTaskLink({ id: '1', name: '', date: '', status: 'failed', thumbnail: '' })).toBe('/upload?task_id=1');
    expect(getTaskLink({ id: '2', name: '', date: '', status: 'pending-review', thumbnail: '' })).toBe('/review/2');
    expect(getTaskLink({ id: '3', name: '', date: '', status: 'completed', thumbnail: '' })).toBe('/results/3');
  });
});
