'use client';

import { useEffect, useState } from 'react';
import { useScoreData } from '@/contexts/editor-provider';
import {
  useRevisionContent,
  useScoreArtifacts,
  useScoreDetail,
} from '@/hooks/queries/use-score-queries';

export function useResultsResources(scoreId: string) {
  const { setRawXml, setScoreData } = useScoreData();
  const scoreQuery = useScoreDetail(scoreId);
  const score = scoreQuery.data?.data;
  const revisionId = score?.head_revision_id;
  const revisionQuery = useRevisionContent(scoreId, revisionId);
  const artifactQuery = useScoreArtifacts(scoreId, {
    revisionId: revisionId ?? undefined,
    enabled: Boolean(revisionId),
  });
  const [parsedTitle, setParsedTitle] = useState('');
  const xmlContent = revisionQuery.data?.data?.content;

  useEffect(() => {
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
  }, [setRawXml, setScoreData, xmlContent]);

  return {
    artifacts: artifactQuery.data?.data ?? [],
    imageCount: artifactQuery.data?.data?.filter((artifact) => artifact.kind === 'RENDERED_PAGE').length ?? 0,
    parsedTitle,
    rawXml: xmlContent ?? '',
    score,
    scoreError: scoreQuery.error ?? revisionQuery.error ?? artifactQuery.error,
    scoreLoading: scoreQuery.isLoading || revisionQuery.isLoading,
  };
}
