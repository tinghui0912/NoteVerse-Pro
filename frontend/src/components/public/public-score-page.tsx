'use client';

import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Footer } from '@/components/layout/footer';
import { ResultsScorePlayer } from '@/components/results/results-score-player';
import { EditorProvider } from '@/contexts/editor-provider';
import { usePublicScore, usePublicScoreContent } from '@/hooks/queries/use-score-queries';
import { filesApi, publicationsApi } from '@/lib/api';

function PublicScoreContent({ slug }: { slug: string }) {
  const common = useTranslations('common');
  const results = useTranslations('results');
  const publication = usePublicScore(slug);
  const content = usePublicScoreContent(slug);
  const data = publication.data?.data;
  const rawXml = content.data?.data?.content ?? '';
  if (publication.isLoading || content.isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!data || publication.error || content.error) {
    return <div className="flex min-h-screen items-center justify-center">{common('loadFailed')}</div>;
  }
  const download = async (kind: 'MUSICXML' | 'RENDERED_PAGE') => {
    const artifacts = data.artifacts.filter((artifact) => artifact.kind === kind);
    for (const artifact of artifacts) {
      const blob = await publicationsApi.downloadArtifact(slug, artifact.artifact_id);
      filesApi.triggerDownload(blob, artifact.filename);
    }
  };
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{data.title}</h1></div></div>
      <main className="grow"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 lg:grid-cols-3"><div className="lg:col-span-2"><ResultsScorePlayer rawXml={rawXml} /></div><aside className="space-y-6"><Card><CardHeader><CardTitle>{results('scoreInfo')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between"><span>{results('scoreName')}</span><strong>{data.title}</strong></div>{data.metadata?.status === 'READY' ? <div className="flex justify-between"><span>{results('totalPages')}</span><strong>{data.metadata.measure_count ?? '-'}</strong></div> : null}</CardContent></Card>{data.capabilities.can_download ? <Card><CardHeader><CardTitle>{common('download')}</CardTitle></CardHeader><CardContent className="space-y-3"><Button variant="outline" className="w-full" onClick={() => void download('MUSICXML')}><Download className="mr-2 h-4 w-4" />{results('downloadMusicXML')}</Button><Button variant="outline" className="w-full" onClick={() => void download('RENDERED_PAGE')}><Download className="mr-2 h-4 w-4" />{results('downloadImage')}</Button></CardContent></Card> : null}</aside></div></main>
      <Footer />
      <div aria-hidden="true" className="h-36 shrink-0 md:h-28" />
    </div>
  );
}

export function PublicScorePage({ slug }: { slug: string }) {
  return <EditorProvider><PublicScoreContent slug={slug} /></EditorProvider>;
}
