'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { FileImage, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';

function ReviewCarousel({ title, altKey, urls, loading }: { title: string; altKey: 'originalScorePage' | 'recognizedScorePage'; urls: string[]; loading: boolean }) {
  const t = useTranslations('review');
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
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle>{title}</CardTitle>{urls.length ? <span className="text-sm text-gray-500">{current + 1} / {urls.length}</span> : null}</CardHeader>
      <CardContent>
        {loading ? <div className="flex aspect-8.5/11 w-full items-center justify-center rounded-md bg-gray-100"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div> : urls.length ? (
          <Carousel className="w-full" setApi={setApi}><CarouselContent>{urls.map((url, index) => <CarouselItem key={url}><div className="relative flex aspect-8.5/11 w-full items-center justify-center overflow-hidden rounded-md bg-gray-100"><Image src={url} alt={t(altKey, { page: index + 1 })} fill unoptimized className="rounded-md object-contain" /></div></CarouselItem>)}</CarouselContent>{urls.length > 1 ? <><CarouselPrevious className="left-2" /><CarouselNext className="right-2" /></> : null}</Carousel>
        ) : <div className="flex aspect-8.5/11 w-full flex-col items-center justify-center rounded-md bg-gray-100"><FileImage className="mb-2 h-12 w-12 text-gray-400" /><p className="text-sm text-gray-500">{scoreText('noImageAvailable')}</p></div>}
      </CardContent>
    </Card>
  );
}

export function ReviewScoreComparison({ original, preview }: { original: { urls: string[]; loading: boolean }; preview: { urls: string[]; loading: boolean } }) {
  const t = useTranslations('review');
  return <div className="grid grid-cols-1 gap-8 lg:grid-cols-2"><ReviewCarousel title={t('originalScore')} altKey="originalScorePage" {...original} /><ReviewCarousel title={t('recognizedScore')} altKey="recognizedScorePage" {...preview} /></div>;
}
