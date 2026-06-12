'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ScoreEntity, AddLocation, EntityLocation } from '@/types/score-types';

/**
 * 编辑器模式
 */
export type EditorMode =
    | 'select'
    | 'insert'
    | 'delete'
    | 'addTie'
    | 'deleteTie'
    | 'addSlur'
    | 'deleteSlur'
    | 'addBeam'
    | 'deleteBeam';

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

    // 添加实体状态
    isAddEntityModalOpen: boolean;
    setIsAddEntityModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    currentAddLocation: AddLocation | null;
    setCurrentAddLocation: React.Dispatch<React.SetStateAction<AddLocation | null>>;

    // 待插入实体
    pendingInsert: { entity: ScoreEntity; location: AddLocation } | null;
    setPendingInsert: React.Dispatch<React.SetStateAction<{ entity: ScoreEntity; location: AddLocation } | null>>;
    pendingInsertRef: React.MutableRefObject<{ entity: ScoreEntity; location: AddLocation } | null>;

    // 图片查看器
    isImageViewerOpen: boolean;
    setIsImageViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;

    // 清空选择状态的回调（用于 Connection 操作）
    onToolChange: ((mode: EditorMode) => void) | null;
    setOnToolChange: (callback: ((mode: EditorMode) => void) | null) => void;
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
    const [isAddEntityModalOpen, setIsAddEntityModalOpen] = useState(false);
    const [currentAddLocation, setCurrentAddLocation] = useState<AddLocation | null>(null);
    const [pendingInsert, setPendingInsert] = useState<{ entity: ScoreEntity; location: AddLocation } | null>(null);
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [onToolChange, setOnToolChangeState] = useState<((mode: EditorMode) => void) | null>(null);

    // Ref for pending insert
    const pendingInsertRef = React.useRef<{ entity: ScoreEntity; location: AddLocation } | null>(null);

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
        isAddEntityModalOpen,
        setIsAddEntityModalOpen,
        currentAddLocation,
        setCurrentAddLocation,
        pendingInsert,
        setPendingInsert,
        pendingInsertRef,
        isImageViewerOpen,
        setIsImageViewerOpen,
        onToolChange,
        setOnToolChange,
    }), [
        editorMode, selectTool, editingEntity, editingEntityLocation,
        isAddEntityModalOpen, currentAddLocation, pendingInsert,
        isImageViewerOpen, onToolChange, setOnToolChange
    ]);

    return (
        <EditorStateContext.Provider value={value}>
            {children}
        </EditorStateContext.Provider>
    );
}
