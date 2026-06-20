'use client';

import { useCallback, useMemo, useState } from 'react';

export function useHistorySelection(currentPageIds: string[]) {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);

  const clear = useCallback(() => {
    setSelectedItems([]);
    setSelectionMode(false);
  }, []);

  const toggleItem = useCallback((id: string) => {
    setSelectedItems((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }, []);

  const selectAll = useCallback(
    (checked: boolean) => {
      setSelectedItems((current) => {
        if (!checked) return current.filter((id) => !currentPageIds.includes(id));
        return Array.from(new Set([...current, ...currentPageIds]));
      });
    },
    [currentPageIds]
  );

  const toggleMode = useCallback(() => {
    if (selectionMode) setSelectedItems([]);
    setSelectionMode(!selectionMode);
  }, [selectionMode]);

  const isAllSelected = useMemo(
    () => currentPageIds.length > 0 && currentPageIds.every((id) => selectedItems.includes(id)),
    [currentPageIds, selectedItems]
  );

  return { clear, isAllSelected, selectAll, selectedItems, selectionMode, toggleItem, toggleMode };
}
