'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useDownload } from '@/hooks/use-download';

interface ShareInfoSidebarProps {
  canDownload: boolean;
  canEdit: boolean;
  difficulty: string;
  expiresAt: string;
  imageCount: number;
  scoreTitle: string;
  shareId: string;
  sharedBy: string;
}

export function ShareInfoSidebar(props: ShareInfoSidebarProps) {
  const t = useTranslations('share');
  const common = useTranslations('common');
  const results = useTranslations('results');
  const upload = useTranslations('upload');
  const { handleDownload } = useDownload({ mode: 'share', id: props.shareId, imageCount: props.imageCount });
  return (
    <div className="sticky top-8 space-y-6 lg:col-span-1">
      <Card className="rounded-2xl bg-white shadow-lg"><CardHeader><CardTitle>{results('scoreInfo')}</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div className="flex items-center justify-between gap-2"><Label className="shrink-0 text-muted-foreground">{results('scoreName')}</Label><span className="flex-1 truncate text-right text-sm font-medium">{props.scoreTitle}</span></div><div className="flex justify-between"><Label className="text-muted-foreground">{results('scoreDifficulty')}</Label><p className="font-medium">{props.difficulty ? upload(props.difficulty as never) : ''}</p></div></CardContent></Card>
      <Card className="rounded-2xl bg-white shadow-lg"><CardHeader><CardTitle>{t('info')}</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">{t('sharedBy')}</span><span className="font-medium">{props.sharedBy}</span></div><div className="flex justify-between"><span className="text-muted-foreground">{t('permissionLabel')}</span><span className="font-medium">{t(props.canEdit ? 'canEdit' : 'viewOnly')}</span></div><div className="flex justify-between"><span className="text-muted-foreground">{t('expirationDate')}</span><span className="font-medium">{props.expiresAt || t('permanent')}</span></div></CardContent></Card>
      <Card className="rounded-2xl bg-white shadow-lg"><CardHeader><CardTitle>{common('download')}</CardTitle></CardHeader><CardContent className="flex flex-col space-y-3"><Button variant="outline" className="w-full justify-start bg-white" onClick={() => handleDownload('image')} disabled={!props.canDownload}><Download className="mr-2 h-4 w-4" />{results('downloadImage')}</Button><Button variant="outline" className="w-full justify-start bg-white" onClick={() => handleDownload('xml')} disabled={!props.canDownload}><Download className="mr-2 h-4 w-4" />{results('downloadMusicXML')}</Button></CardContent></Card>
    </div>
  );
}
