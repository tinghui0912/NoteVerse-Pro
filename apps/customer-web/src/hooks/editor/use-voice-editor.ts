'use client';

/**
 * Voice editing hook for deleting global MusicXML voice tracks.
 */

import { useCallback } from 'react';
import { useScoreData } from '@/contexts/score-data-context';
import { useHistory } from '@/contexts/editor-history-context';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import {
    parseXml,
    serializeXml,
} from '@/lib/musicxml/core';
import { useTranslations } from 'next-intl';
import { recalculateBackups } from '@/lib/musicxml/backup';
import { reportUnexpectedClientError } from '@/lib/observability';

export function useVoiceEditor() {
    const t = useTranslations('editor.actions');
    const {
        scoreData,
        currentXml,
        currentXmlRef,
        setScoreData,
        setCurrentXml
    } = useScoreData();

    const history = useHistory();

    const handleDeleteVoiceTrack = useCallback((xmlVoice: number) => {
        if (!currentXml || !scoreData) return;

        try {
            const xmlDoc = parseXml(currentXml);

            Array.from(xmlDoc.querySelectorAll('measure')).forEach((measureEl) => {
                Array.from(measureEl.querySelectorAll('note, forward')).forEach((element) => {
                    const voiceEl = element.querySelector('voice');
                    const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

                    if (voice === xmlVoice) {
                        element.remove();
                    }
                });

                recalculateBackups(measureEl);
            });

            const newXml = serializeXml(xmlDoc);
            history.push(newXml, t('deleteVoice', { voice: xmlVoice }));
            currentXmlRef.current = newXml;
            setCurrentXml(newXml);

            const parser = new MusicXMLParser(newXml);
            setScoreData(parser.parse());
        } catch (error) {
            reportUnexpectedClientError(error, {
                area: 'editor',
                action: 'delete_voice_track',
            });
        }
    }, [currentXml, currentXmlRef, scoreData, setCurrentXml, setScoreData, history, t]);

    return {
        handleDeleteVoiceTrack,
    };
}
