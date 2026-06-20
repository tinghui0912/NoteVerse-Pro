'use client';

import Image from 'next/image';
import { FileImage, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';

export function ResultsScorePreview({ imageUrls, loading }: { imageUrls: string[]; loading: boolean }) {
  const t = useTranslations('results');
  return (
    <Card className="w-full rounded-2xl bg-white shadow-lg">
      <CardContent className="p-4">
        {loading ? (
          <div className="flex aspect-8.5/11 w-full items-center justify-center rounded-md bg-gray-100"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
        ) : imageUrls.length > 0 ? (
          <Carousel className="w-full">
            <CarouselContent>
              {imageUrls.map((url, index) => (
                <CarouselItem key={url}>
                  <div className="relative flex aspect-8.5/11 w-full items-center justify-center rounded-md bg-white">
                    <Image src={url} alt={`${t('scoreInfo')} ${index + 1}`} fill unoptimized className="rounded-md object-contain" />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-2" />
            <CarouselNext className="right-2" />
          </Carousel>
        ) : (
          <div className="flex aspect-8.5/11 w-full flex-col items-center justify-center rounded-md bg-gray-100">
            <FileImage className="mb-2 h-12 w-12 text-gray-400" />
            <p className="text-sm text-gray-500">{t('noImageAvailable')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
