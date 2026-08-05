'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ScoreEntity, EntityLocation } from '@/types/score-types';

/**
 * 编辑器模式
 */
export type EditorMode =
    | 'select'
    | 'add'
    | 'delete'
    | 'addTie'
    | 'deleteTie'
    | 'addSlur'
    | 'deleteSlur';

/**
 * EditorState Context - 管理编辑器 UI 状态
 */
interface EditorStateContextType {
    // 编辑器模式
    editorMode: EditorMode;
    selectTool: (mode: EditorMode) => void;

    // 当前编辑状态
    editingEntity: ScoreEntity | null;
    setEditingEntity: React.Dispatch<React.SetStateAction<ScoreEntity | null>>;
    editingEntityLocation: EntityLocation | null;
    setEditingEntityLocation: React.Dispatch<React.SetStateAction<EntityLocation | null>>;

    // 图片查看器
    isImageViewerOpen: boolean;
    setIsImageViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;

    // 清空选择状态的回调（用于 Connection 操作）
    onToolChange: ((mode: EditorMode) => void) | null;
    setOnToolChange: (callback: ((mode: EditorMode) => void) | null) => void;

    // Workbench UI 状态
    activeTrackId: string | null;
    setActiveTrackId: React.Dispatch<React.SetStateAction<string | null>>;
    visibleTrackIds: string[];
    setVisibleTrackIds: React.Dispatch<React.SetStateAction<string[]>>;
    inspectorOpen: boolean;
    setInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const EditorStateContext = createContext<EditorStateContextType | undefined>(undefined);

/**
 * EditorState Hook - 获取编辑器状态
 */
export function useEditorState() {
    const context = useContext(EditorStateContext);
    if (!context) {
        throw new Error('useEditorState must be used within an EditorStateProvider');
    }
    return context;
}

interface EditorStateProviderProps {
    children: React.ReactNode;
}

/**
 * EditorState Provider - 提供编辑器状态上下文
 */
export function EditorStateProvider({ children }: EditorStateProviderProps) {
    const [editorMode, setEditorMode] = useState<EditorMode>('select');
    const [editingEntity, setEditingEntity] = useState<ScoreEntity | null>(null);
    const [editingEntityLocation, setEditingEntityLocation] = useState<EntityLocation | null>(null);
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [onToolChange, setOnToolChangeState] = useState<((mode: EditorMode) => void) | null>(null);
    const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
    const [visibleTrackIds, setVisibleTrackIds] = useState<string[]>([]);
    const [inspectorOpen, setInspectorOpen] = useState(false);

    const selectTool = useCallback((mode: EditorMode) => {
        // 如果点击当前已激活的模式，则切换回默认的 select 模式
        const newMode = editorMode === mode ? 'select' : mode;
        setEditorMode(newMode);
        // 通知 Connection 操作清空选择状态
        if (onToolChange) {
            onToolChange(newMode);
        }
    }, [editorMode, onToolChange]);



    const setOnToolChange = useCallback((callback: ((mode: EditorMode) => void) | null) => {
        setOnToolChangeState(() => callback);
    }, []);

    const value = useMemo<EditorStateContextType>(() => ({
        editorMode,
        selectTool,
        editingEntity,
        setEditingEntity,
        editingEntityLocation,
        setEditingEntityLocation,
        isImageViewerOpen,
        setIsImageViewerOpen,
        onToolChange,
        setOnToolChange,
        activeTrackId,
        setActiveTrackId,
        visibleTrackIds,
        setVisibleTrackIds,
        inspectorOpen,
        setInspectorOpen,
    }), [
        editorMode, selectTool, editingEntity, editingEntityLocation,
        isImageViewerOpen, onToolChange, setOnToolChange,
        activeTrackId, visibleTrackIds, inspectorOpen
    ]);

    return (
        <EditorStateContext.Provider value={value}>
            {children}
        </EditorStateContext.Provider>
    );
}
