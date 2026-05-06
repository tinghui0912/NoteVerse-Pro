'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { Check, Edit, Loader2, FileImage } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { Footer } from '@/components/layout/footer';
import { getTaskDetails } from '@/lib/api/tasks';
import type { TaskDetails } from '@/types/api';
import { confirmRecognition } from '@/lib/api/xml';
import { fetchAuthenticatedImage } from '@/lib/utils/image';

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id: taskId } = resolvedParams;
  const t = useTranslations('review');
  const tCommon = useTranslations('common');
  const tResults = useTranslations('results');
  const tb = useBackendMessage();
  const router = useRouter();

  // 状态
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskDetails, setTaskDetails] = useState<TaskDetails | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 预加载的图片 URL 数组
  const [originalImageUrls, setOriginalImageUrls] = useState<string[]>([]);
  const [previewImageUrls, setPreviewImageUrls] = useState<string[]>([]);
  const [imagesLoading, setImagesLoading] = useState({ original: true, preview: true });

  // Carousel API 状态（用于跟踪当前页码）
  const [originalApi, setOriginalApi] = useState<CarouselApi>();
  const [previewApi, setPreviewApi] = useState<CarouselApi>();
  const [originalCurrent, setOriginalCurrent] = useState(0);
  const [previewCurrent, setPreviewCurrent] = useState(0);

  // 计算页数
  const originalImages = taskDetails?.files?.original_image || [];
  const previewImages = taskDetails?.files?.preview_image || [];
  const totalOriginalPages = originalImages.length;
  const totalPreviewPages = previewImages.length;

  // 加载任务详情
  const loadTaskDetails = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getTaskDetails(taskId);

      if (response.data) {
        // 验证任务状态（允许 PENDING_REVIEW 和 SUCCESS）
        if (response.data.state !== 'SUCCESS' && response.data.state !== 'PENDING_REVIEW') {
          setError(t('invalidTaskState', { state: response.data.state }));
          return;
        }
        setTaskDetails(response.data);
      } else {
        setError(t('loadTaskFailed'));
      }
    } catch (err) {
      console.error('加载任务详情失败:', err);
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // 预加载所有原图
  const loadAllOriginalImages = useCallback(async () => {
    if (!taskDetails || totalOriginalPages === 0) {
      setImagesLoading(prev => ({ ...prev, original: false }));
      return;
    }

    setImagesLoading(prev => ({ ...prev, original: true }));
    const urls: string[] = [];

    for (let i = 1; i <= totalOriginalPages; i++) {
      const url = await fetchAuthenticatedImage(taskId, 'original_image', i);
      if (url) urls.push(url);
    }

    setOriginalImageUrls(urls);
    setImagesLoading(prev => ({ ...prev, original: false }));
  }, [taskId, taskDetails, totalOriginalPages]);

  // 预加载所有预览图
  const loadAllPreviewImages = useCallback(async () => {
    if (!taskDetails || totalPreviewPages === 0) {
      setImagesLoading(prev => ({ ...prev, preview: false }));
      return;
    }

    setImagesLoading(prev => ({ ...prev, preview: true }));
    const urls: string[] = [];

    for (let i = 1; i <= totalPreviewPages; i++) {
      const url = await fetchAuthenticatedImage(taskId, 'preview_image', i);
      if (url) urls.push(url);
    }

    setPreviewImageUrls(urls);
    setImagesLoading(prev => ({ ...prev, preview: false }));
  }, [taskId, taskDetails, totalPreviewPages]);

  useEffect(() => {
    loadTaskDetails();
  }, [loadTaskDetails]);

  // 任务详情加载完成后预加载所有图片
  useEffect(() => {
    if (taskDetails) {
      loadAllOriginalImages();
      loadAllPreviewImages();
    }
  }, [taskDetails, loadAllOriginalImages, loadAllPreviewImages]);

  // 清理 blob URLs
  useEffect(() => {
    return () => {
      originalImageUrls.forEach(url => URL.revokeObjectURL(url));
      previewImageUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // 监听 Carousel 页面变化
  useEffect(() => {
    if (!originalApi) return;
    setOriginalCurrent(originalApi.selectedScrollSnap());
    originalApi.on('select', () => {
      setOriginalCurrent(originalApi.selectedScrollSnap());
    });
  }, [originalApi]);

  useEffect(() => {
    if (!previewApi) return;
    setPreviewCurrent(previewApi.selectedScrollSnap());
    previewApi.on('select', () => {
      setPreviewCurrent(previewApi.selectedScrollSnap());
    });
  }, [previewApi]);

  // 确认识别结果
  const handleConfirm = async () => {
    try {
      setConfirming(true);

      // 直接调用 confirm 接口，服务端读取 current_xml 并复制到 final.xml
      const response = await confirmRecognition(taskId);

      if (response.success) {
        // 跳转到结果页
        router.push(`/results/${taskId}`);
      } else {
        setError(response.message || t('saveFailed'));
      }
    } catch (err) {
      console.error('确认识别结果失败:', err);
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setConfirming(false);
    }
  };

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
                            <img
                              src={url}
                              alt={t('originalScorePage', { page: index + 1 })}
                              className="max-w-full max-h-full object-contain rounded-md"
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
                            <img
                              src={url}
                              alt={t('recognizedScorePage', { page: index + 1 })}
                              className="max-w-full max-h-full object-contain rounded-md"
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
