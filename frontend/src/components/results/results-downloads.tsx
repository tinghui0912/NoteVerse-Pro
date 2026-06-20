'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDownload } from '@/hooks/use-download';

export function ResultsDownloads({ taskId, imageCount }: { taskId: string; imageCount: number }) {
  const t = useTranslations('results');
  const common = useTranslations('common');
  const { handleDownload } = useDownload({ mode: 'task', id: taskId, imageCount });
  return (
    <Card className="rounded-2xl bg-white shadow-lg">
      <CardHeader><CardTitle>{common('download')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col space-y-3">
        <Button variant="outline" className="w-full justify-start bg-white" onClick={() => handleDownload('image')}><Download className="mr-2 h-4 w-4" />{t('downloadImage')}</Button>
        <Button variant="outline" className="w-full justify-start bg-white" onClick={() => handleDownload('xml')}><Download className="mr-2 h-4 w-4" />{t('downloadMusicXML')}</Button>
      </CardContent>
    </Card>
  );
}
