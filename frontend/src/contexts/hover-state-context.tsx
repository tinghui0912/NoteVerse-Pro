'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { EntityLocation } from '@/types/score-types';

/**
 * HoverState Context - 管理卡片悬停状态（高频更新，独立隔离）
 *
 * 从 EditorStateProvider 中拆出，避免鼠标移动时触发整棵编辑器组件树重渲染。
 */
interface HoverStateContextType {
    hoveredCardLocation: EntityLocation | null;
    handleMouseEnterCard: (location: EntityLocation | null) => void;
    handleMouseLeaveCard: () => void;
}

const HoverStateContext = createContext<HoverStateContextType | undefined>(undefined);

/**
 * HoverState Hook - 获取悬停状态
 */
export function useHoverState() {
    const context = useContext(HoverStateContext);
    if (!context) {
        throw new Error('useHoverState must be used within a HoverStateProvider');
    }
    return context;
}

interface HoverStateProviderProps {
    children: React.ReactNode;
}

/**
 * HoverState Provider - 提供卡片悬停状态上下文
 */
export function HoverStateProvider({ children }: HoverStateProviderProps) {
    const [hoveredCardLocation, setHoveredCardLocation] = useState<EntityLocation | null>(null);

    const handleMouseEnterCard = useCallback((location: EntityLocation | null) => {
        setHoveredCardLocation(location);
    }, []);

    const handleMouseLeaveCard = useCallback(() => {
        setHoveredCardLocation(null);
    }, []);

    const value = useMemo<HoverStateContextType>(() => ({
        hoveredCardLocation,
        handleMouseEnterCard,
        handleMouseLeaveCard,
    }), [hoveredCardLocation, handleMouseEnterCard, handleMouseLeaveCard]);

    return (
        <HoverStateContext.Provider value={value}>
            {children}
        </HoverStateContext.Provider>
    );
}
