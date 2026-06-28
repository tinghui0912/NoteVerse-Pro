'use client';

import React from 'react';
import { Check, CircleAlert, Edit, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { ReviewScoreComparison } from '@/components/review/review-score-comparison';
import { ReviewValidationWarnings } from '@/components/review/review-validation-warnings';
import { useReviewPageData } from '@/hooks/review/use-review-page-data';

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: scoreId } = React.use(params);
  const t = useTranslations('review');
  const common = useTranslations('common');
  const router = useRouter();
  const page = useReviewPageData(scoreId);

  if (page.loading) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1><p className="text-lg text-gray-300">{t('subtitle')}</p></div></div>
        <main className="flex grow items-center justify-center"><div className="text-center"><Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-orange-500" /><p className="text-gray-600">{common('loading')}</p></div></main>
        <Footer />
      </div>
    );
  }

  if (page.error) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>
        <main className="flex grow items-center justify-center py-16"><div className="mx-4 w-full max-w-md text-center"><CircleAlert className="mx-auto mb-6 h-14 w-14 text-destructive" /><h2 className="mb-3 text-2xl font-bold text-gray-900">{common('loadFailed')}</h2><p className="mb-2 text-gray-600">{page.error}</p><p className="mb-8 text-sm text-gray-500">{t('loadFailedHint')}</p><Button onClick={() => router.back()} className="px-8">{common('back')}</Button></div></main>
        <Footer />
      </div>
    );
  }

  const editorHref = `/editor/${scoreId}?returnUrl=${encodeURIComponent(`/review/${scoreId}`)}`;
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1><p className="text-lg text-gray-300">{t('subtitle')}</p></div></div>
      <main className="grow">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <ReviewValidationWarnings warnings={page.validationWarnings} />
          <ReviewScoreComparison original={page.original} preview={page.preview} />
          <div className="mt-8 flex justify-center gap-4">
            <Button asChild variant="outline" size="lg" className="rounded-full bg-white shadow-lg"><Link href={editorHref}><Edit className="mr-2 h-5 w-5" />{t('needsEdit')}</Link></Button>
            <Button size="lg" className="rounded-full bg-orange-500 text-white shadow-lg hover:bg-orange-600" onClick={page.confirmRecognition} disabled={page.confirming}>{page.confirming ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />{t('processing')}</> : <><Check className="mr-2 h-5 w-5" />{t('looksGood')}</>}</Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
