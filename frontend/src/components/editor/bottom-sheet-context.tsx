'use client';

import { createContext, useContext } from 'react';

/**
 * 底部抽屉 Context - 用于在卡片组件中触发移动端底部抽屉
 */
export interface BottomSheetContextValue {
    openSheet: (content: { title: string; lines: string[] }) => void;
}

export const BottomSheetContext = createContext<BottomSheetContextValue | null>(null);

export const useBottomSheet = () => useContext(BottomSheetContext);
