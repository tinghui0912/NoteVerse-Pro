'use client';

/**
 * XML 更新器 Hook - 提供 updateMusicXML 函数
 */

import { useCallback } from 'react';
import { useScoreData } from '@/contexts/score-data-context';
import { useHistory } from '@/contexts/editor-history-context';
import { useTranslations } from 'next-intl';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import {
    parseXml,
    serializeXml,
} from '@/lib/musicxml/core';

export function useXmlUpdater() {
    const t = useTranslations('editor.actions');
    const {
        scoreData,
        currentXml,
        currentXmlRef,
        setScoreData,
        setCurrentXml,
        getExpectedVoices
    } = useScoreData();

    const history = useHistory();

    const updateMusicXML = useCallback((updater: (doc: XMLDocument) => void, actionName?: string) => {
        if (!currentXml && !currentXmlRef.current) return;
        try {
            const oldXml = currentXmlRef.current || currentXml || '';
            const xmlDoc = parseXml(oldXml);
            updater(xmlDoc);
            const newXmlString = serializeXml(xmlDoc);

            if (oldXml !== newXmlString) {
                // 默认使用 actionName，如果有的话。如果没有则用 t('xmlUpdate')
                history.push(newXmlString, actionName || t('xmlUpdate'));
            }

            currentXmlRef.current = newXmlString;
            setCurrentXml(newXmlString);

            const newParser = new MusicXMLParser(newXmlString, {
                expectedVoices: getExpectedVoices(scoreData)
            });
            setScoreData(newParser.parse());
        } catch (e) {
            console.error("Failed to update MusicXML", e);
        }
    }, [currentXml, currentXmlRef, history, setCurrentXml, getExpectedVoices, scoreData, setScoreData, t]);

    return { updateMusicXML };
}
