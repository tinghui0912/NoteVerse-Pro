'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
    ArrowLeft,
    Bookmark,
    Download,
    Edit,
    FileImage,
    Gamepad2,
    Loader2,
    Play,
} from 'lucide-react';

import { Link, routing } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useDownload } from '@/hooks/use-download';
import { useSaveToCollection } from '@/hooks/queries/use-share-queries';
import { queryKeys } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Footer } from '@/components/layout/footer';
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    CarouselNext,
    CarouselPrevious,
} from '@/components/ui/carousel';
import { ListenModal } from '@/components/listen-modal';
import { sharesApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { fetchSharedImage } from '@/lib/utils/image';

export default function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
    const resolvedParams = React.use(params);
    const { shareId } = resolvedParams;
    const locale = useLocale();
    const t = useTranslations('share');
    const tCommon = useTranslations('common');
    const tResults = useTranslations('results');
    const tUpload = useTranslations('upload');
    const tPractice = useTranslations('practice');
    const router = useRouter();
    const { toast } = useToast();
    const { isAuthenticated, isLoading: authLoading } = useAuth();

    const [isListenModalOpen, setIsListenModalOpen] = useState(false);

    // 璁よ瘉瀹堝崼
    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) {
            const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
            const loginPath = locale === routing.defaultLocale ? '/login' : `/${locale}/login`;
            router.replace(`${loginPath}?returnUrl=${returnUrl}`);
        }
    }, [authLoading, isAuthenticated, locale, router]);

    // ============ TanStack Query锛氬姞杞藉垎浜暟鎹?============
    const {
        data: shareResponse,
        isLoading: isLoadingShare,
        error: shareError,
    } = useQuery({
        queryKey: queryKeys.shares.access(shareId),
        queryFn: () => sharesApi.accessShare(shareId),
        enabled: isAuthenticated && !authLoading,
        retry: false, // 鍒嗕韩閿欒涓嶉噸璇曪紙not_found/revoked/expired 閲嶈瘯鏃犳剰涔夛級
    });

    const shareData = shareResponse?.data ?? null;

    // 浠庡搷搴斾腑鎻愬彇瀛楁
    const scoreTitle = shareData?.task.title || '';
    const scoreDifficulty = shareData?.task.difficulty || '';
    const taskId = shareData?.task.task_id || '';
    const sharedBy = shareData?.share_info.shared_by || t('anonymousUser');
    const expiresAt = shareData?.share_info.expires_at || t('permanent');
    const canDownload = shareData?.share_info.can_download || false;

    // 鍒嗙被閿欒鐘舵€?
    const errorState = useMemo(() => {
        if (!shareError) return { type: null as null, message: '' };
        if (shareError instanceof ApiError) {
            switch (shareError.code) {
                case 'share_not_found':
                    return { type: 'not_found' as const, message: shareError.message };
                case 'share_revoked':
                    return { type: 'revoked' as const, message: shareError.message };
                case 'share_expired':
                    return {
                        type: 'expired' as const,
                        message: shareError.message,
                        expiredAt: shareError.details?.expired_at as string | undefined,
                    };
                default:
                    return { type: null as null, message: shareError.message };
            }
        }
        return { type: null as null, message: t('loadFailedDesc') };
    }, [shareError, t]);

    // ============ Image loading ============
    const finalImages = shareData?.task.files?.final_image || [];
    const finalImageSignature = finalImages.map(image => image.storage_key).join('|');
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [imagesLoading, setImagesLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;

        if (!shareData || finalImages.length <= 0) {
            return () => {};
        }

        const loadImages = async () => {
            await Promise.resolve();
            if (cancelled) return;

            setImagesLoading(true);
            setImageUrls([]);

            const urls: string[] = [];
            for (let i = 0; i < finalImages.length; i += 1) {
                const url = await fetchSharedImage(shareId, i + 1);
                if (url) {
                    urls.push(url);
                }
            }
            if (!cancelled) {
                setImageUrls(urls);
                setImagesLoading(false);
            }
        };

        loadImages();

        return () => {
            cancelled = true;
        };
    }, [shareData, shareId, finalImages.length, finalImageSignature]);

    // ============ TanStack Query锛氬姞杞?XML ============
    const { data: rawXml = null } = useQuery({
        queryKey: ['share-xml', shareId],
        queryFn: async () => {
            try {
                const xmlBlob = await sharesApi.downloadSharedFile(shareId, 'final_xml');
                return await xmlBlob.text() || null;
            } catch {
                return null;
            }
        },
        enabled: !!shareData,
        staleTime: Infinity,
    });

    // ============ 鏀惰棌 mutation ============
    const saveMutation = useSaveToCollection();

    const handleBookmark = () => {
        saveMutation.mutate(shareId, {
            onSuccess: () => {
                toast({
                    title: t('saveSuccessTitle'),
                    description: t('saveSuccessDesc', { scoreName: '{scoreName}' }).replace('{scoreName}', scoreTitle),
                });
            },
            onError: (error) => {
                toast({
                    title: t('saveFailed'),
                    description: error instanceof ApiError ? error.message : t('saveFailedDesc'),
                    variant: 'destructive',
                });
            },
        });
    };

    const isSaving = saveMutation.isPending;
    const isLoading = isLoadingShare;

    const { handleDownload } = useDownload({
        mode: 'share',
        id: shareId,
        imageCount: imageUrls.length,
    });

    const actionButtons = [
        { label: tCommon('play'), icon: Play, isModal: true },
        { label: tPractice('mode'), icon: Gamepad2, href: taskId ? `/practice/${taskId}?shareToken=${shareId}` : '#' },
        { label: tCommon('edit'), icon: Edit, href: taskId ? `/editor/${taskId}?source=final&shareToken=${shareId}&returnUrl=/share/${shareId}` : '#' },
        { label: t('saveToHistory'), icon: Bookmark, onClick: handleBookmark, loading: isSaving },
    ];

    if (authLoading || isLoading) {
        return (
            <div className="bg-gray-50 min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (errorState.type) {
        const errorConfig = {
            not_found: {
                icon: '棣冩晢',
                title: t('errorNotFoundTitle'),
                description: t('errorNotFoundDesc'),
                hint: t('hintNotFound'),
            },
            revoked: {
                icon: '棣冩瘒',
                title: t('errorRevokedTitle'),
                description: t('errorRevokedDesc'),
                hint: t('hintRevoked'),
            },
            expired: {
                icon: '閳?',
                title: t('errorExpiredTitle'),
                description: errorState.expiredAt
                    ? t('errorExpiredDescWithDate', { date: new Date(errorState.expiredAt).toLocaleString() })
                    : t('errorExpiredDesc'),
                hint: t('hintExpired'),
            },
        };

        const config = errorConfig[errorState.type];

        return (
            <div className="bg-gray-50 min-h-screen flex flex-col">
                <div className="bg-gray-900">
                    <div className="pt-32 pb-16 max-w-7xl mx-auto px-4">
                        <div className="w-full flex items-center">
                            <div className="w-12 shrink-0">
                                <Button
                                    variant="ghost"
                                    onClick={() => router.back()}
                                    className="text-white hover:bg-white/10 hover:text-white h-12 w-12 rounded-full [&_svg]:size-6"
                                >
                                    <ArrowLeft />
                                </Button>
                            </div>
                            <div className="flex-1 text-center">
                                <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('sharedScore')}</h1>
                                <p className="text-lg text-gray-300">{config.title}</p>
                            </div>
                            <div className="w-12 shrink-0" />
                        </div>
                    </div>
                </div>

                <main className="grow flex items-center justify-center py-16">
                    <div className="max-w-md w-full mx-4 text-center">
                        <div className="text-6xl mb-6">{config.icon}</div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-3">{config.title}</h2>
                        <p className="text-gray-600 mb-2">{config.description}</p>
                        <p className="text-gray-500 text-sm mb-8">{config.hint}</p>
                        <Button onClick={() => router.push('/')} className="px-8">
                            {tCommon('nav.home')}
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
                <div className="pt-32 pb-16 max-w-7xl mx-auto px-4">
                    <div className="w-full flex items-center">
                        <div className="w-12 shrink-0">
                            <Button
                                variant="ghost"
                                onClick={() => router.back()}
                                className="text-white hover:bg-white/10 hover:text-white h-12 w-12 rounded-full [&_svg]:size-6"
                            >
                                <ArrowLeft />
                            </Button>
                        </div>
                        <div className="flex-1 text-center">
                            <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('sharedScore')}</h1>
                            <p className="text-lg text-gray-300">{t('sharedScoreSubtitle')}</p>
                        </div>
                        <div className="w-12 shrink-0" />
                    </div>
                </div>
            </div>
            <main className="grow">
                <div className="max-w-7xl mx-auto px-4 py-16">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                        <div className="lg:col-span-2 space-y-6">
                            <Card className="bg-white rounded-2xl w-full shadow-lg">
                                <CardContent className="p-4">
                                    {imagesLoading ? (
                                        <div className="flex items-center justify-center aspect-8.5/11 w-full bg-gray-100 rounded-md">
                                            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                                        </div>
                                    ) : imageUrls.length > 0 ? (
                                        <Carousel className="w-full">
                                            <CarouselContent>
                                                {imageUrls.map((url, idx) => (
                                                    <CarouselItem key={idx}>
                                                        <div className="relative aspect-8.5/11 w-full bg-white rounded-md flex items-center justify-center">
                                                            <Image
                                                                src={url}
                                                                alt={`Score Page ${idx + 1}`}
                                                                fill
                                                                unoptimized
                                                                className="object-contain rounded-md"
                                                            />
                                                        </div>
                                                    </CarouselItem>
                                                ))}
                                            </CarouselContent>
                                            <CarouselPrevious className="left-2" />
                                            <CarouselNext className="right-2" />
                                        </Carousel>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center aspect-8.5/11 w-full bg-gray-100 rounded-md">
                                            <FileImage className="h-12 w-12 text-gray-400 mb-2" />
                                            <p className="text-gray-500 text-sm">{tResults('noImageAvailable')}</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {actionButtons.map(btn => {
                                    const buttonContent = (
                                        <div className="flex flex-col items-center justify-center h-full">
                                            {'loading' in btn && btn.loading ? (
                                                <Loader2 className="h-6 w-6 mb-2 animate-spin" />
                                            ) : (
                                                <btn.icon className="h-6 w-6 mb-2" />
                                            )}
                                            <span>{btn.label}</span>
                                        </div>
                                    );

                                    const isLink = 'href' in btn;

                                    const buttonComponent = (
                                        <Button
                                            key={btn.label}
                                            variant="outline"
                                            className="h-24 rounded-2xl bg-white w-full"
                                            asChild={isLink}
                                            onClick={'onClick' in btn ? btn.onClick : undefined}
                                            disabled={'loading' in btn ? btn.loading : false}
                                        >
                                            {isLink ? <Link href={btn.href!}>{buttonContent}</Link> : buttonContent}
                                        </Button>
                                    );

                                    if ('isModal' in btn && btn.isModal) {
                                        return (
                                            <React.Fragment key={btn.label}>
                                                <span onClick={() => setIsListenModalOpen(true)}>{buttonComponent}</span>
                                                <ListenModal
                                                    isOpen={isListenModalOpen}
                                                    onOpenChange={setIsListenModalOpen}
                                                    xmlString={rawXml}
                                                />
                                            </React.Fragment>
                                        );
                                    }

                                    return buttonComponent;
                                })}
                            </div>
                        </div>

                        <div className="lg:col-span-1 space-y-6 sticky top-8">
                            <Card className="bg-white rounded-2xl shadow-lg">
                                <CardHeader>
                                    <CardTitle>{tResults('scoreInfo')}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 text-sm">
                                    <div className="flex justify-between items-center text-sm gap-2">
                                        <Label className="text-muted-foreground shrink-0">{tResults('scoreName')}</Label>
                                        <span className="font-medium text-sm text-right truncate flex-1">{scoreTitle}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <Label className="text-muted-foreground">{tResults('scoreDifficulty')}</Label>
                                        <p className="font-medium">{scoreDifficulty ? tUpload(scoreDifficulty as never) : ''}</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="bg-white rounded-2xl shadow-lg">
                                <CardHeader>
                                    <CardTitle>{t('info')}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t('sharedBy')}</span>
                                        <span className="font-medium">{sharedBy}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t('permissionLabel')}</span>
                                        <span className="font-medium">{t('viewOnly')}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t('expirationDate')}</span>
                                        <span className="font-medium">{expiresAt || t('permanent')}</span>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="bg-white rounded-2xl shadow-lg">
                                <CardHeader>
                                    <CardTitle>{tCommon('download')}</CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col space-y-3">
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start bg-white"
                                        onClick={() => handleDownload('image')}
                                        disabled={!canDownload}
                                    >
                                        <Download className="mr-2 h-4 w-4" />
                                        {tResults('downloadImage')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start bg-white"
                                        onClick={() => handleDownload('xml')}
                                        disabled={!canDownload}
                                    >
                                        <Download className="mr-2 h-4 w-4" />
                                        {tResults('downloadMusicXML')}
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
