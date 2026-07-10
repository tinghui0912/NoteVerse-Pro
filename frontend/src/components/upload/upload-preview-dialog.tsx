'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { UploadableFile } from '@/lib/upload/upload-workflow';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface UploadPreviewDialogProps {
  files: UploadableFile[];
  open: boolean;
  startIndex: number;
  onOpenChange: (open: boolean) => void;
}

export function UploadPreviewDialog({ files, open, startIndex, onOpenChange }: UploadPreviewDialogProps) {
  const t = useTranslations('upload');
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(startIndex);

  useEffect(() => {
    if (!carouselApi) return;
    const updateSlide = () => setCurrentSlide(carouselApi.selectedScrollSnap());
    updateSlide();
    carouselApi.on('select', updateSlide);
    return () => {
      carouselApi.off('select', updateSlide);
    };
  }, [carouselApi]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-5xl flex flex-col p-2 sm:p-4">
        <DialogHeader className="flex-row items-center justify-between space-y-0 p-2 sm:pb-2">
          <DialogTitle className="truncate text-sm sm:text-base">{files[currentSlide]?.file.name}</DialogTitle>
          <DialogClose className="relative rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">{t('closePreview')}</span>
          </DialogClose>
        </DialogHeader>
        <Carousel setApi={setCarouselApi} opts={{ startIndex, loop: true }} className="w-full relative">
          <CarouselContent>
            {files.map((item, index) => (
              <CarouselItem key={`${item.file.name}-${index}`}>
                <div className="relative w-full h-[80vh]">
                  <Image src={item.preview} alt={item.file.name} fill unoptimized className="object-contain rounded-md" />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-2" />
          <CarouselNext className="right-2" />
        </Carousel>
      </DialogContent>
    </Dialog>
  );
}
