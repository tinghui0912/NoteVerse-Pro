'use client';

/**
 * 撤销重做控制 Hook
 */

import { useCallback } from 'react';
import { useScoreData } from '@/contexts/score-data-context';
import { useHistory } from '@/contexts/editor-history-context';
import { useEditorState } from '@/contexts/editor-state-context';
import { findEntityById } from '@/lib/editor/score-lookup';

export function useHistoryEditor() {
    const history = useHistory();
    const { setCurrentXml, currentXmlRef, reparseXml } = useScoreData();
    const {
        editingEntity,
        setEditingEntity,
        setEditingEntityLocation,
        setInspectorOpen,
    } = useEditorState();

    const applyHistoryXml = useCallback((xml: string) => {
        currentXmlRef.current = xml;
        setCurrentXml(xml);
        const parsed = reparseXml(xml);
        const selectedId = editingEntity?.meta?.id;
        if (!selectedId) return;
        const refreshed = findEntityById(parsed, selectedId);
        if (refreshed) {
            setEditingEntity(refreshed.entity);
            setEditingEntityLocation(refreshed.meta);
        } else {
            setEditingEntity(null);
            setEditingEntityLocation(null);
            setInspectorOpen(false);
        }
    }, [
        currentXmlRef,
        editingEntity?.meta?.id,
        reparseXml,
        setCurrentXml,
        setEditingEntity,
        setEditingEntityLocation,
        setInspectorOpen,
    ]);

    const handleUndo = useCallback(() => {
        const xml = history.undo();
        if (xml) applyHistoryXml(xml);
    }, [applyHistoryXml, history]);

    const handleRedo = useCallback(() => {
        const xml = history.redo();
        if (xml) applyHistoryXml(xml);
    }, [applyHistoryXml, history]);

    return {
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        handleUndo,
        handleRedo,
    };
}
