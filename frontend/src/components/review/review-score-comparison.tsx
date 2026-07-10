'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { FileImage } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PreviewLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { ScorePreviewViewport } from '@/components/score/score-preview-viewport';
import { useScorePreviewPlayback } from '@/hooks/score/use-score-preview-playback';
import { useMeasureWarningOverlay } from '@/hooks/score/use-measure-warning-overlay';
import type { ScoreValidationIssue } from '@/lib/musicxml/validator';
import type { ScorePreviewControllerFactory } from '@/hooks/score/use-score-preview-playback';

const A4_HEIGHT_TO_WIDTH_RATIO = 297 / 210;

const createReviewScoreController: ScorePreviewControllerFactory = async (container, bpm) => {
  const { VerovioScorePreviewController } = await import(
    '@/lib/score/verovio-score-preview-controller'
  );
  return new VerovioScorePreviewController({
    container,
    bpm,
    toolkitOptions: {
      pageWidth: 2100,
      pageHeight: 2970,
      adjustPageHeight: false,
      justifyVertically: true,
      justificationBraceGroup: 0,
      justificationSystem: 1,
    },
    fitToContainerOptions: (pageWidth) => ({
      pageWidth,
      pageHeight: Math.round(pageWidth * A4_HEIGHT_TO_WIDTH_RATIO),
    }),
  });
};

function ReviewCarousel({
  title,
  altKey,
  urls,
  loading,
}: {
  title: string;
  altKey: 'originalScorePage' | 'recognizedScorePage';
  urls: string[];
  loading: boolean;
}) {
  const t = useTranslations('review');
  const common = useTranslations('common');
  const scoreText = useTranslations('score');
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    const frame = window.requestAnimationFrame(onSelect);
    api.on('select', onSelect);
    return () => {
      window.cancelAnimationFrame(frame);
      api.off('select', onSelect);
    };
  }, [api]);
  return (
    <Card className="rounded-2xl bg-white shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {urls.length ? (
          <span className="text-sm text-gray-500">
            {current + 1} / {urls.length}
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? <PreviewLoading label={common('loading')} className="aspect-[210/297] min-h-0 w-full rounded-md bg-white" /> : urls.length ? (
          <Carousel className="w-full" setApi={setApi}>
            <CarouselContent>
              {urls.map((url, index) => (
                <CarouselItem key={url}>
                  <div className="relative flex aspect-[210/297] w-full items-center justify-center overflow-hidden rounded-md bg-white">
                    <Image
                      src={url}
                      alt={t(altKey, { page: index + 1 })}
                      fill
                      unoptimized
                      className="rounded-md object-contain"
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            {urls.length > 1 ? (
              <>
                <CarouselPrevious className="left-2" />
                <CarouselNext className="right-2" />
              </>
            ) : null}
          </Carousel>
        ) : <EmptyState icon={FileImage} title={scoreText('noImageAvailable')} className="aspect-[210/297] min-h-0 w-full rounded-md bg-white" />}
      </CardContent>
    </Card>
  );
}

function RecognizedScorePreview({ xmlString, issues }: { xmlString: string | null; issues: ScoreValidationIssue[] }) {
  const t = useTranslations('review');
  const scoreText = useTranslations('score');
  const {
    containerRef,
    isLoading,
    loadError,
    scoreContainerRef,
  } = useScorePreviewPlayback({
    isOpen: Boolean(xmlString),
    xmlString,
    createController: createReviewScoreController,
  });
  useMeasureWarningOverlay({ containerRef, isLoading, issues });

  return (
    <Card className="rounded-2xl bg-white shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('recognizedScore')}</CardTitle>
      </CardHeader>
      <CardContent>
        {xmlString ? (
          <ScorePreviewViewport
            className="aspect-[210/297] min-h-0 rounded-md bg-white [&_.verovio-preview-page]:mb-0"
            containerRef={containerRef}
            isLoading={isLoading}
            loadError={loadError}
            scoreContainerRef={scoreContainerRef}
          />
        ) : (
          <EmptyState
            icon={FileImage}
            title={scoreText('noImageAvailable')}
            className="aspect-8.5/11 min-h-0 w-full rounded-md bg-gray-100"
          />
        )}
      </CardContent>
    </Card>
  );
}

export function ReviewScoreComparison({
  original,
  recognizedXml,
  validationIssues,
}: {
  original: { urls: string[]; loading: boolean };
  recognizedXml: string | null;
  validationIssues: ScoreValidationIssue[];
}) {
  const t = useTranslations('review');
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <ReviewCarousel title={t('originalScore')} altKey="originalScorePage" {...original} />
      <RecognizedScorePreview xmlString={recognizedXml} issues={validationIssues} />
    </div>
  );
}
