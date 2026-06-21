'use client';

import React from 'react';
import { ArrowLeft, Ban, CircleAlert, Clock3, Loader2, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { ShareActions } from '@/components/share/share-actions';
import { ShareInfoSidebar } from '@/components/share/share-info-sidebar';
import { ShareScorePreview } from '@/components/share/share-score-preview';
import { useSharePageData } from '@/hooks/share/use-share-page-data';

export default function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = React.use(params);
  const t = useTranslations('share');
  const common = useTranslations('common');
  const router = useRouter();
  const page = useSharePageData(shareId);

  if (page.authLoading || page.loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (page.error || !page.shareData) {
    const type = page.error?.type ?? 'unknown';
    const config = type === 'not_found'
      ? { icon: SearchX, title: t('errorNotFoundTitle'), description: t('errorNotFoundDesc'), hint: t('hintNotFound') }
      : type === 'revoked'
        ? { icon: Ban, title: t('errorRevokedTitle'), description: t('errorRevokedDesc'), hint: t('hintRevoked') }
        : type === 'expired'
          ? {
              icon: Clock3,
              title: t('errorExpiredTitle'),
              description: page.error?.expiredAt ? t('errorExpiredDescWithDate', { date: new Date(page.error.expiredAt).toLocaleString() }) : t('errorExpiredDesc'),
              hint: t('hintExpired'),
            }
          : { icon: CircleAlert, title: t('loadFailed'), description: page.error?.message || t('loadFailed'), hint: t('hintNotFound') };
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32"><div className="flex w-full items-center"><div className="w-12 shrink-0"><Button variant="ghost" onClick={() => router.back()} className="h-12 w-12 rounded-full text-white hover:bg-white/10 hover:text-white [&_svg]:size-6"><ArrowLeft /></Button></div><div className="flex-1 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('sharedScore')}</h1><p className="text-lg text-gray-300">{config.title}</p></div><div className="w-12 shrink-0" /></div></div></div>
        <main className="flex grow items-center justify-center py-16"><div className="mx-4 w-full max-w-md text-center"><config.icon className="mx-auto mb-6 h-14 w-14 text-destructive" /><h2 className="mb-3 text-2xl font-bold text-gray-900">{config.title}</h2><p className="mb-2 text-gray-600">{config.description}</p><p className="mb-8 text-sm text-gray-500">{config.hint}</p><Button onClick={() => router.push('/')} className="px-8">{common('nav.home')}</Button></div></main>
        <Footer />
      </div>
    );
  }

  const data = page.shareData;
  const taskId = data.task.task_id;
  const scoreTitle = data.task.title || '';
  const canDownload = data.share_info.can_download;
  const canEdit = data.share_info.can_edit;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32"><div className="flex w-full items-center"><div className="w-12 shrink-0"><Button variant="ghost" onClick={() => router.back()} className="h-12 w-12 rounded-full text-white hover:bg-white/10 hover:text-white [&_svg]:size-6"><ArrowLeft /></Button></div><div className="flex-1 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('sharedScore')}</h1><p className="text-lg text-gray-300">{t('sharedScoreSubtitle')}</p></div><div className="w-12 shrink-0" /></div></div></div>
      <main className="grow"><div className="mx-auto max-w-7xl px-4 py-16"><div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3"><div className="space-y-6 lg:col-span-2"><ShareScorePreview imageUrls={page.imageUrls} loading={page.imagesLoading} /><ShareActions canEdit={canEdit} isAuthenticated={page.isAuthenticated} rawXml={page.rawXml} scoreTitle={scoreTitle} shareId={shareId} taskId={taskId} /></div><ShareInfoSidebar canDownload={canDownload} canEdit={canEdit} difficulty={data.task.difficulty || ''} expiresAt={data.share_info.expires_at || t('permanent')} imageCount={page.imageUrls.length} scoreTitle={scoreTitle} shareId={shareId} sharedBy={data.share_info.shared_by || t('anonymousUser')} /></div></div></main>
      <Footer />
    </div>
  );
}
