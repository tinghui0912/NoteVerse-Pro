'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ScoreEntity, EntityLocation } from '@/types/score-types';

/**
 * Editor tool mode.
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
 * Editor UI state context.
 */
interface EditorStateContextType {
    // Active editor tool.
    editorMode: EditorMode;
    selectTool: (mode: EditorMode) => void;

    // Current entity editing state.
    editingEntity: ScoreEntity | null;
    setEditingEntity: React.Dispatch<React.SetStateAction<ScoreEntity | null>>;
    editingEntityLocation: EntityLocation | null;
    setEditingEntityLocation: React.Dispatch<React.SetStateAction<EntityLocation | null>>;

    // Original image viewer state.
    isImageViewerOpen: boolean;
    setIsImageViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;

    // Callback for clearing tool-specific selection state.
    onToolChange: ((mode: EditorMode) => void) | null;
    setOnToolChange: (callback: ((mode: EditorMode) => void) | null) => void;

    // Workbench UI state.
    activeTrackId: string | null;
    setActiveTrackId: React.Dispatch<React.SetStateAction<string | null>>;
    visibleTrackIds: string[];
    setVisibleTrackIds: React.Dispatch<React.SetStateAction<string[]>>;
    inspectorOpen: boolean;
    setInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const EditorStateContext = createContext<EditorStateContextType | undefined>(undefined);

/**
 * Returns editor UI state.
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
 * Provides editor UI state.
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
        // Clicking the active tool toggles back to select mode.
        const newMode = editorMode === mode ? 'select' : mode;
        setEditorMode(newMode);
        // Notify connection tools so they can clear selection state.
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
