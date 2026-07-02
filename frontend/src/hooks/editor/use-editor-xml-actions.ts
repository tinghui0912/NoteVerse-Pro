'use client';

import { useCallback } from 'react';
import { useHistory, useScoreData } from '@/contexts/editor-provider';
import { normalizeMeasureVoices } from '@/lib/musicxml/flatten';
import { ensureStableMusicXmlIdsString } from '@/lib/musicxml/stable-ids';

export function useEditorXmlActions() {
  const { setScoreData, setRawXml, currentXml, currentXmlRef, setCurrentXml } = useScoreData();
  const { initialize: initializeHistory, push: pushHistory } = useHistory();

  const applyXml = useCallback(async (
    xml: string,
    options: {
      historyLabel?: string;
      resetHistory?: boolean;
      updateRawXml?: boolean;
    } = {}
  ) => {
    const normalizedXml = ensureStableMusicXmlIdsString(xml);
    currentXmlRef.current = normalizedXml;
    setCurrentXml(normalizedXml);
    if (options.updateRawXml) setRawXml(normalizedXml);
    if (options.resetHistory ?? true) {
      initializeHistory(normalizedXml);
    } else if (options.historyLabel) {
      pushHistory(normalizedXml, options.historyLabel);
    }
    const { MusicXMLParser } = await import('@/lib/musicxml/parser');
    setScoreData(new MusicXMLParser(normalizedXml).parse());
    return normalizedXml;
  }, [currentXmlRef, initializeHistory, pushHistory, setCurrentXml, setRawXml, setScoreData]);

  const normalizeVoices = useCallback(async () => {
    if (!currentXml) return;
    await applyXml(normalizeMeasureVoices(currentXml), { resetHistory: true });
  }, [applyXml, currentXml]);

  const clearXml = useCallback(() => {
    setScoreData(null);
    setRawXml(null);
  }, [setRawXml, setScoreData]);

  return {
    applyXml,
    clearXml,
    currentXml,
    normalizeVoices,
  };
}
