'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { Check, Edit, Loader2, FileImage } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Footer } from '@/components/layout/footer';
import { useTaskDetail } from '@/hooks/queries/use-task-queries';
import { useConfirmRecognition } from '@/hooks/queries/use-xml-queries';
import { queryKeys } from '@/lib/query-client';
import { fetchAuthenticatedImage } from '@/lib/utils/image';

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id: taskId } = resolvedParams;
  const t = useTranslations('review');
  const tCommon = useTranslations('common');
  const tResults = useTranslations('results');
  const router = useRouter();

  // ============ TanStack Query：任务详情 ============
  const {
    data: taskResponse,
    isLoading: loading,
    error: taskError,
  } = useTaskDetail(taskId);

  const taskDetails = taskResponse?.data ?? null;

  // 验证任务状态
  const error = useMemo(() => {
    if (taskError) return taskError instanceof Error ? taskError.message : t('loadFailed');
    if (taskDetails && taskDetails.state !== 'SUCCESS' && taskDetails.state !== 'PENDING_REVIEW') {
      return t('invalidTaskState', { state: taskDetails.state });
    }
    return null;
  }, [taskError, taskDetails, t]);

  // 计算页数
  const originalImages = taskDetails?.files?.original_image || [];
  const previewImages = taskDetails?.files?.preview_image || [];
  const totalOriginalPages = originalImages.length;
  const totalPreviewPages = previewImages.length;

  // ============ TanStack Query：预加载原始图片 ============
  const { data: originalImageUrls = [], isLoading: originalImagesLoading } = useQuery({
    queryKey: queryKeys.images.task(taskId, 'original_image'),
    queryFn: async () => {
      const urls: string[] = [];
      for (let i = 1; i <= totalOriginalPages; i++) {
        const url = await fetchAuthenticatedImage(taskId, 'original_image', i);
        if (url) urls.push(url);
      }
      return urls;
    },
    enabled: !!taskDetails && totalOriginalPages > 0,
    staleTime: Infinity,
    gcTime: 0,
  });

  // ============ TanStack Query：预加载预览图片 ============
  const { data: previewImageUrls = [], isLoading: previewImagesLoading } = useQuery({
    queryKey: queryKeys.images.task(taskId, 'preview_image'),
    queryFn: async () => {
      const urls: string[] = [];
      for (let i = 1; i <= totalPreviewPages; i++) {
        const url = await fetchAuthenticatedImage(taskId, 'preview_image', i);
        if (url) urls.push(url);
      }
      return urls;
    },
    enabled: !!taskDetails && totalPreviewPages > 0,
    staleTime: Infinity,
    gcTime: 0,
  });

  const imagesLoading = {
    original: originalImagesLoading,
    preview: previewImagesLoading,
  };

  const originalImageUrlsRef = useRef<string[]>([]);
  const previewImageUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    originalImageUrlsRef.current = originalImageUrls;
  }, [originalImageUrls]);

  useEffect(() => {
    previewImageUrlsRef.current = previewImageUrls;
  }, [previewImageUrls]);

  useEffect(() => {
    return () => {
      originalImageUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      previewImageUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // ============ 确认识别 mutation ============
  const confirmMutation = useConfirmRecognition();

  // Carousel API 状态（用于跟踪当前页码）
  const [originalApi, setOriginalApi] = useState<CarouselApi>();
  const [previewApi, setPreviewApi] = useState<CarouselApi>();
  const [originalCurrent, setOriginalCurrent] = useState(0);
  const [previewCurrent, setPreviewCurrent] = useState(0);

  // 监听 Carousel 页面变化
  useEffect(() => {
    if (!originalApi) return;
    const onSelect = () => {
      setOriginalCurrent(originalApi.selectedScrollSnap());
    };
    const frame = window.requestAnimationFrame(onSelect);
    originalApi.on('select', onSelect);
    return () => {
      window.cancelAnimationFrame(frame);
      originalApi.off('select', onSelect);
    };
  }, [originalApi]);

  useEffect(() => {
    if (!previewApi) return;
    const onSelect = () => {
      setPreviewCurrent(previewApi.selectedScrollSnap());
    };
    const frame = window.requestAnimationFrame(onSelect);
    previewApi.on('select', onSelect);
    return () => {
      window.cancelAnimationFrame(frame);
      previewApi.off('select', onSelect);
    };
  }, [previewApi]);

  // 确认识别结果
  const handleConfirm = () => {
    confirmMutation.mutate({ taskId }, {
      onSuccess: (response) => {
        if (response.success) {
          router.push(`/results/${taskId}`);
        }
      },
    });
  };

  const confirming = confirmMutation.isPending;

  // 加载中状态
  if (loading) {
    return (
      <div className="bg-gray-50 min-h-screen flex flex-col">
        <div className="bg-gray-900">
          <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
            <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
            <p className="text-lg text-gray-300">{t('subtitle')}</p>
          </div>
        </div>
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-orange-500 mx-auto mb-4" />
            <p className="text-gray-600">{tCommon('loading')}</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="bg-gray-50 min-h-screen flex flex-col">
        <div className="bg-gray-900">
          <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
            <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          </div>
        </div>
        <main className="flex-grow flex items-center justify-center py-16">
          <div className="max-w-md w-full mx-4 text-center">
            <div className="text-6xl mb-6">⚠️</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">{tCommon('loadFailed')}</h2>
            <p className="text-gray-600 mb-2">{error}</p>
            <p className="text-gray-500 text-sm mb-8">{t('loadFailedHint')}</p>
            <Button onClick={() => router.back()} className="px-8">
              {tCommon('back')}
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>
      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 原始图片 */}
            <Card className="bg-white rounded-2xl shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t('originalScore')}</CardTitle>
                {totalOriginalPages > 0 && (
                  <span className="text-sm text-gray-500">
                    {originalCurrent + 1} / {totalOriginalPages}
                  </span>
                )}
              </CardHeader>
              <CardContent>
                {imagesLoading.original ? (
                  <div className="flex items-center justify-center aspect-[8.5/11] w-full bg-gray-100 rounded-md">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  </div>
                ) : originalImageUrls.length > 0 ? (
                  <Carousel className="w-full" setApi={setOriginalApi}>
                    <CarouselContent>
                      {originalImageUrls.map((url, index) => (
                        <CarouselItem key={index}>
                          <div className="relative aspect-[8.5/11] w-full bg-gray-100 rounded-md overflow-hidden flex items-center justify-center">
                            <Image
                              src={url}
                              alt={t('originalScorePage', { page: index + 1 })}
                              fill
                              unoptimized
                              className="object-contain rounded-md"
                            />
                          </div>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    {totalOriginalPages > 1 && (
                      <>
                        <CarouselPrevious className="left-2" />
                        <CarouselNext className="right-2" />
                      </>
                    )}
                  </Carousel>
                ) : (
                  <div className="flex flex-col items-center justify-center aspect-[8.5/11] w-full bg-gray-100 rounded-md">
                    <FileImage className="h-12 w-12 text-gray-400 mb-2" />
                    <p className="text-gray-500 text-sm">{tResults('noImageAvailable')}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 识别结果预览 */}
            <Card className="bg-white rounded-2xl shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t('recognizedScore')}</CardTitle>
                {totalPreviewPages > 0 && (
                  <span className="text-sm text-gray-500">
                    {previewCurrent + 1} / {totalPreviewPages}
                  </span>
                )}
              </CardHeader>
              <CardContent>
                {imagesLoading.preview ? (
                  <div className="flex items-center justify-center aspect-[8.5/11] w-full bg-gray-100 rounded-md">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  </div>
                ) : previewImageUrls.length > 0 ? (
                  <Carousel className="w-full" setApi={setPreviewApi}>
                    <CarouselContent>
                      {previewImageUrls.map((url, index) => (
                        <CarouselItem key={index}>
                          <div className="relative aspect-[8.5/11] w-full bg-gray-100 rounded-md overflow-hidden flex items-center justify-center">
                            <Image
                              src={url}
                              alt={t('recognizedScorePage', { page: index + 1 })}
                              fill
                              unoptimized
                              className="object-contain rounded-md"
                            />
                          </div>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    {totalPreviewPages > 1 && (
                      <>
                        <CarouselPrevious className="left-2" />
                        <CarouselNext className="right-2" />
                      </>
                    )}
                  </Carousel>
                ) : (
                  <div className="flex flex-col items-center justify-center aspect-[8.5/11] w-full bg-gray-100 rounded-md">
                    <FileImage className="h-12 w-12 text-gray-400 mb-2" />
                    <p className="text-gray-500 text-sm">{tResults('noImageAvailable')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 操作按钮 */}
          <div className="mt-8 flex justify-center gap-4">
            <Button asChild variant="outline" size="lg" className="rounded-full shadow-lg bg-white">
              <Link href={`/editor/${taskId}?source=current`}>
                <Edit className="mr-2 h-5 w-5" />
                {t('needsEdit')}
              </Link>
            </Button>
            <Button
              size="lg"
              className="rounded-full shadow-lg bg-orange-500 hover:bg-orange-600 text-white"
              onClick={handleConfirm}
              disabled={confirming}
            >
              {confirming ? (
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
      </main>
      <Footer />
    </div>
  );
}
