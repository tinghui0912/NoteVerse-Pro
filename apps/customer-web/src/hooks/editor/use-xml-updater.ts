'use client';

/**
 * XML updater hook that exposes updateMusicXML.
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
import { ensureStableMusicXmlIds } from '@/lib/musicxml/stable-ids';

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
            ensureStableMusicXmlIds(xmlDoc);
            const newXmlString = serializeXml(xmlDoc);

            if (oldXml !== newXmlString) {
                // Use the explicit action name when provided, otherwise fall back to the generic XML update label.
                history.push(newXmlString, actionName || t('xmlUpdate'));
            }

            currentXmlRef.current = newXmlString;
            setCurrentXml(newXmlString);

            const newParser = new MusicXMLParser(newXmlString, {
                expectedVoices: getExpectedVoices(scoreData)
            });
            setScoreData(newParser.parse());
        } catch {
            // Keep the previous editable score state when an update cannot be applied.
        }
    }, [currentXml, currentXmlRef, history, setCurrentXml, getExpectedVoices, scoreData, setScoreData, t]);

    return { updateMusicXML };
}
