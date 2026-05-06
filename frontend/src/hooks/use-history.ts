'use client';

import { useState, useCallback, useRef } from 'react';

/**
 * 历史记录条目
 */
type HistoryEntry = {
    xml: string;
    timestamp: number;
    action?: string;
};

/**
 * 历史管理 Hook
 * 用于实现撤销/重做功能
 * 
 * @param maxSize 历史栈最大深度，默认 20
 */
export function useHistory(maxSize = 20) {
    // 撤销栈
    const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
    // 重做栈
    const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
    // 当前状态
    const currentRef = useRef<HistoryEntry | null>(null);

    // 使用 ref 同步追踪栈长度，解决 React 状态异步更新问题
    const undoStackRef = useRef<HistoryEntry[]>([]);
    const redoStackRef = useRef<HistoryEntry[]>([]);

    // 触发重新渲染的计数器
    const [, forceUpdate] = useState(0);

    /**
     * 初始化历史记录（在加载 XML 后调用）
     */
    const init = useCallback((xml: string) => {
        currentRef.current = {
            xml,
            timestamp: Date.now(),
            action: 'init'
        };
        undoStackRef.current = [];
        redoStackRef.current = [];
        setUndoStack([]);
        setRedoStack([]);
    }, []);

    /**
     * 推入历史记录（在每次修改后调用）
     * 
     * @param xml 新的 XML 状态
     * @param action 操作描述（用于调试）
     */
    const push = useCallback((xml: string, action?: string) => {
        if (!currentRef.current) {
            // 如果没有初始化，先初始化
            currentRef.current = { xml, timestamp: Date.now(), action };
            return;
        }

        // 如果 XML 没有变化，不记录
        if (currentRef.current.xml === xml) {
            return;
        }

        // 将当前状态推入撤销栈（同步更新 ref）
        const newUndoStack = [...undoStackRef.current, currentRef.current];
        if (newUndoStack.length > maxSize) {
            undoStackRef.current = newUndoStack.slice(-maxSize);
        } else {
            undoStackRef.current = newUndoStack;
        }
        setUndoStack(undoStackRef.current);

        // 清空重做栈（同步更新 ref）
        redoStackRef.current = [];
        setRedoStack([]);

        // 更新当前状态
        currentRef.current = {
            xml,
            timestamp: Date.now(),
            action
        };

        // 强制重新渲染以更新 canUndo/canRedo
        forceUpdate(n => n + 1);

    }, [maxSize]);

    /**
     * 撤销操作
     * @returns 撤销后的 XML，如果无法撤销则返回 null
     */
    const undo = useCallback((): string | null => {
        if (undoStackRef.current.length === 0) {
            return null;
        }

        // 获取撤销栈顶元素
        const prevState = undoStackRef.current[undoStackRef.current.length - 1];

        // 将当前状态推入重做栈（同步更新 ref）
        if (currentRef.current) {
            redoStackRef.current = [...redoStackRef.current, currentRef.current];
            setRedoStack(redoStackRef.current);
        }

        // 从撤销栈弹出（同步更新 ref）
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        setUndoStack(undoStackRef.current);

        // 更新当前状态
        currentRef.current = prevState;

        // 强制重新渲染
        forceUpdate(n => n + 1);

        return prevState.xml;
    }, []);

    /**
     * 重做操作
     * @returns 重做后的 XML，如果无法重做则返回 null
     */
    const redo = useCallback((): string | null => {
        if (redoStackRef.current.length === 0) {
            return null;
        }

        // 获取重做栈顶元素
        const nextState = redoStackRef.current[redoStackRef.current.length - 1];

        // 将当前状态推入撤销栈（同步更新 ref）
        if (currentRef.current) {
            undoStackRef.current = [...undoStackRef.current, currentRef.current];
            setUndoStack(undoStackRef.current);
        }

        // 从重做栈弹出（同步更新 ref）
        redoStackRef.current = redoStackRef.current.slice(0, -1);
        setRedoStack(redoStackRef.current);

        // 更新当前状态
        currentRef.current = nextState;

        // 强制重新渲染
        forceUpdate(n => n + 1);

        return nextState.xml;
    }, []);

    /**
     * 是否可以撤销
     */
    const canUndo = undoStack.length > 0;

    /**
     * 是否可以重做
     */
    const canRedo = redoStack.length > 0;

    return {
        init,
        push,
        undo,
        redo,
        canUndo,
        canRedo
    };
}
