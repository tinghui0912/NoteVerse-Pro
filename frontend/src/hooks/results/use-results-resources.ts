'use client';

import { useEffect, useMemo, useState } from 'react';
import { useScoreData } from '@/contexts/editor-provider';
import { useTaskDetail } from '@/hooks/queries/use-task-queries';
import { useXmlContent } from '@/hooks/queries/use-xml-queries';

export function useResultsResources(taskId: string) {
  const { setRawXml, setScoreData } = useScoreData();
  const taskQuery = useTaskDetail(taskId);
  const task = taskQuery.data?.data;
  const xmlQuery = useXmlContent(taskId, 'final', { enabled: Boolean(task) });
  const [parsedTitle, setParsedTitle] = useState('');
  const finalImages = useMemo(() => task?.files?.final_image ?? [], [task?.files?.final_image]);

  useEffect(() => {
    const xmlContent = xmlQuery.data;
    if (!xmlContent) return;
    let cancelled = false;
    setRawXml(xmlContent);

    void import('@/lib/musicxml/parser').then(({ MusicXMLParser }) => {
      if (cancelled) return;
      try {
        const data = new MusicXMLParser(xmlContent).parse();
        setScoreData(data);
        setParsedTitle(data.mainTitle ?? '');
      } catch (error) {
        console.error('Failed to parse XML', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [setRawXml, setScoreData, xmlQuery.data]);

  return {
    imageCount: finalImages.length,
    parsedTitle,
    rawXml: xmlQuery.data ?? '',
    task,
    taskError: taskQuery.error,
    taskLoading: taskQuery.isLoading,
  };
}
