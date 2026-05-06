'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';

/**
 * 历史记录条目
 */
interface HistoryEntry {
    xml: string;
    action: string;
    timestamp: number;
}

/**
 * History Context - 管理撤销/重做历史
 */
interface HistoryContextType {
    // 历史状态
    canUndo: boolean;
    canRedo: boolean;

    // 历史操作
    push: (xml: string, action: string) => void;
    undo: () => string | null;
    redo: () => string | null;

    // 获取当前 XML
    getCurrentXml: () => string | null;

    // 初始化（设置初始状态）
    initialize: (xml: string) => void;
    isInitialized: boolean;
}

const HistoryContext = createContext<HistoryContextType | undefined>(undefined);

/**
 * History Hook - 获取历史控制
 */
export function useHistory() {
    const context = useContext(HistoryContext);
    if (!context) {
        throw new Error('useHistory must be used within a HistoryProvider');
    }
    return context;
}

/**
 * HistoryControl Hook - 获取撤销/重做控制（常用简易版）
 */
export function useHistoryControl() {
    const { canUndo, canRedo, undo, redo } = useHistory();
    return { canUndo, canRedo, undo, redo };
}

interface HistoryProviderProps {
    children: React.ReactNode;
    maxHistorySize?: number;
    onXmlChange?: (xml: string) => void;
}

/**
 * History Provider - 提供历史记录上下文
 */
export function HistoryProvider({
    children,
    maxHistorySize = 50,
    onXmlChange
}: HistoryProviderProps) {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isInitialized, setIsInitialized] = useState(false);

    // 使用 Ref 来避免 onXmlChange 闭包问题
    const onXmlChangeRef = useRef(onXmlChange);
    useEffect(() => {
        onXmlChangeRef.current = onXmlChange;
    }, [onXmlChange]);

    const canUndo = currentIndex > 0;
    const canRedo = currentIndex < history.length - 1;

    /**
     * 初始化历史记录
     */
    const initialize = useCallback((xml: string) => {
        if (isInitialized) return;

        setHistory([{
            xml,
            action: 'initial',
            timestamp: Date.now()
        }]);
        setCurrentIndex(0);
        setIsInitialized(true);
    }, [isInitialized]);

    /**
     * 推送新的历史记录
     */
    const push = useCallback((xml: string, action: string) => {
        // 先检查是否与当前 XML 相同（去重）
        const currentXml = history[currentIndex]?.xml;
        if (currentXml === xml) {
            return; // 不推送相同的 XML
        }

        setHistory(prev => {
            // 切掉当前索引之后的历史（如果有的话）
            const newHistory = prev.slice(0, currentIndex + 1);

            // 添加新条目
            newHistory.push({
                xml,
                action,
                timestamp: Date.now()
            });

            // 限制历史大小
            if (newHistory.length > maxHistorySize) {
                newHistory.shift();
            }

            return newHistory;
        });

        setCurrentIndex(prev => Math.min(prev + 1, maxHistorySize - 1));
    }, [currentIndex, maxHistorySize, history]);

    /**
     * 撤销
     */
    const undo = useCallback((): string | null => {
        if (!canUndo) return null;

        const newIndex = currentIndex - 1;
        setCurrentIndex(newIndex);

        const xml = history[newIndex]?.xml || null;
        if (xml && onXmlChangeRef.current) {
            onXmlChangeRef.current(xml);
        }

        return xml;
    }, [canUndo, currentIndex, history]);

    /**
     * 重做
     */
    const redo = useCallback((): string | null => {
        if (!canRedo) return null;

        const newIndex = currentIndex + 1;
        setCurrentIndex(newIndex);

        const xml = history[newIndex]?.xml || null;
        if (xml && onXmlChangeRef.current) {
            onXmlChangeRef.current(xml);
        }

        return xml;
    }, [canRedo, currentIndex, history]);

    /**
     * 获取当前 XML
     */
    const getCurrentXml = useCallback((): string | null => {
        return history[currentIndex]?.xml || null;
    }, [history, currentIndex]);

    const value = useMemo<HistoryContextType>(() => ({
        canUndo,
        canRedo,
        push,
        undo,
        redo,
        getCurrentXml,
        initialize,
        isInitialized,
    }), [canUndo, canRedo, push, undo, redo, getCurrentXml, initialize, isInitialized]);

    return (
        <HistoryContext.Provider value={value}>
            {children}
        </HistoryContext.Provider>
    );
}
