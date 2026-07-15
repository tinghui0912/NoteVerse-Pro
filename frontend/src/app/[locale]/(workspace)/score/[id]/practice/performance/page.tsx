'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Activity, FileText, Lightbulb, Target } from 'lucide-react';

import { ResourceLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page';
import { ScoreSurface } from '@/components/score/score-surface';
import { SectionErrorState } from '@/components/states';
import { practiceApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import type { PracticeReportPayload } from '@/types/api';

const ReportCard = ({
  icon,
  title,
  content,
}: {
  icon: React.ElementType;
  title: string;
  content: string;
}) => {
  const Icon = icon;
  return (
    <Card className="rounded-lg bg-white shadow-sm">
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <Icon className="h-5 w-5 text-orange-500" />
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{content}</p>
      </CardContent>
    </Card>
  );
};

export default function PracticePerformancePage() {
  const t = useTranslations('practice');
  const errors = useTranslations('errors');
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const [report, setReport] = useState<PracticeReportPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadReport = async () => {
      if (!sessionId) {
        setError(t('performanceMissingSession'));
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const response = await practiceApi.requestPracticeReport(sessionId);
        const nextReport =
          response.data ?? (await practiceApi.getPracticeReport(sessionId)).data;
        if (!nextReport?.report_payload) {
          throw new Error(t('analysisFailedDesc'));
        }
        if (!cancelled) {
          setReport(nextReport.report_payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof ApiError
              ? translateErrorCode(errors, loadError.code, t('analysisFailedDesc'))
              : t('analysisFailedDesc')
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadReport();

    return () => {
      cancelled = true;
    };
  }, [errors, sessionId, t]);

  const recommendations = report?.recommendations.join('\n') || '';
  const metricsContent = report
    ? Object.entries(report.metrics)
        .map(([key, value]) => `${key}: ${value ?? 'n/a'}`)
        .join('\n')
    : '';

  return (
    <ScoreSurface>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title={t('performanceTitle')}
          description={t('performanceSubtitle')}
          actions={
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToPractice')}
            </Button>
          }
        />
        {isLoading && <ResourceLoading label={t('loadingReport')} minHeight="md" />}

        {!isLoading && error && (
          <SectionErrorState title={t('analysisFailedTitle')} description={error} />
        )}

        {!isLoading && report && (
          <div className="space-y-6">
            <ReportCard icon={FileText} title={t('summary')} content={report.summary} />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <ReportCard icon={Target} title={t('metrics')} content={metricsContent} />
              <ReportCard
                icon={Lightbulb}
                title={t('recommendations')}
                content={recommendations}
              />
            </div>
            <ReportCard icon={Activity} title={t('report')} content={t('performanceComplete')} />
          </div>
        )}
      </div>
    </ScoreSurface>
  );
}
