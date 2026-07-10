'use client';

import React from 'react';
import { Check, Loader2, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page/page-header';
import { Button } from '@/components/ui/button';
import { ResourceLoadError } from '@/components/error/resource-load-error';
import { ResourceLoading } from '@/components/loading/resource-loading';
import { ReviewScoreComparison } from '@/components/review/review-score-comparison';
import { ReviewValidationWarnings } from '@/components/review/review-validation-warnings';
import { useReviewPageData } from '@/hooks/review/use-review-page-data';

export default function ReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = React.use(params);
  const t = useTranslations('review');
  const common = useTranslations('common');
  const router = useRouter();
  const page = useReviewPageData(jobId);

  if (page.loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <ResourceLoading label={common('loadingReviewData')} />
      </div>
    );
  }

  if (page.error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <ResourceLoadError
          title={common('loadFailed')}
          description={page.error}
          actionLabel={common('back')}
          onAction={() => router.back()}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <ReviewValidationWarnings warnings={page.validationWarnings} />
        <ReviewScoreComparison original={page.original} recognizedXml={page.recognizedXml} validationIssues={page.validationWarnings} />
        <div className="mt-8 flex justify-center gap-4">
          <Button
            size="lg"
            variant="outline"
            className="rounded-full"
            onClick={() => router.push(`/review/${jobId}/edit?returnUrl=${encodeURIComponent(`/review/${jobId}`)}`)}
            disabled={page.confirming}
          >
            <Pencil className="mr-2 h-5 w-5" />
            {t('needsEdit')}
          </Button>
          <Button
            size="lg"
            className="rounded-full bg-orange-500 text-white shadow-lg hover:bg-orange-600"
            onClick={page.confirmRecognition}
            disabled={page.confirming}
          >
            {page.confirming ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {t('processing')}
              </>
            ) : (
              <>
                <Check className="mr-2 h-5 w-5" />
                {t('looksGood')}
              </>
            )}
          </Button>
        </div>
    </div>
  );
}
