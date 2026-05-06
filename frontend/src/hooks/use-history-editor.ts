'use client';

/**
 * 撤销重做控制 Hook
 */

import { useCallback } from 'react';
import { useScoreData } from '../contexts/score-data-context';
import { useHistory } from '../contexts/history-context';

export function useHistoryEditor() {
    const history = useHistory();
    const { setCurrentXml, currentXmlRef, reparseXml } = useScoreData();

    const handleUndo = useCallback(() => {
        const xml = history.undo();
        if (xml) {
            currentXmlRef.current = xml;
            setCurrentXml(xml);
            reparseXml(xml);
        }
    }, [history, currentXmlRef, setCurrentXml, reparseXml]);

    const handleRedo = useCallback(() => {
        const xml = history.redo();
        if (xml) {
            currentXmlRef.current = xml;
            setCurrentXml(xml);
            reparseXml(xml);
        }
    }, [history, currentXmlRef, setCurrentXml, reparseXml]);

    return {
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        handleUndo,
        handleRedo,
    };
}
