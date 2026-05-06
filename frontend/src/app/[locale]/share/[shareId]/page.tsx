'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
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
import { fetchSharedImageAsBlob, revokeImageUrls } from '@/lib/utils/image';

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
    const imageUrlsRef = useRef<string[]>([]);

    const [isListenModalOpen, setIsListenModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [imagesLoading, setImagesLoading] = useState(false);
    const [errorState, setErrorState] = useState<{
        type: 'not_found' | 'revoked' | 'expired' | null;
        message: string;
        expiredAt?: string;
    }>({ type: null, message: '' });

    const [scoreTitle, setScoreTitle] = useState('');
    const [scoreDifficulty, setScoreDifficulty] = useState('');
    const [taskId, setTaskId] = useState('');
    const [sharedBy, setSharedBy] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [canDownload, setCanDownload] = useState(false);
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [rawXml, setRawXml] = useState<string | null>(null);

    useEffect(() => {
        imageUrlsRef.current = imageUrls;
    }, [imageUrls]);

    useEffect(() => {
        return () => {
            revokeImageUrls(imageUrlsRef.current);
        };
    }, []);

    useEffect(() => {
        if (authLoading) {
            return;
        }

        if (!isAuthenticated) {
            const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
            const loginPath = locale === routing.defaultLocale ? '/login' : `/${locale}/login`;
            router.replace(`${loginPath}?returnUrl=${returnUrl}`);
            return;
        }

        const loadShareData = async () => {
            setIsLoading(true);
            setErrorState({ type: null, message: '' });

            try {
                const response = await sharesApi.accessShare(shareId);

                if (!response.data) {
                    return;
                }

                const data = response.data;
                setTaskId(data.task.task_id);
                setScoreTitle(data.task.title || '');
                setScoreDifficulty(data.task.difficulty || '');
                setSharedBy(data.share_info.shared_by || t('anonymousUser'));
                setExpiresAt(data.share_info.expires_at || t('permanent'));
                setCanDownload(data.share_info.can_download || false);

                revokeImageUrls(imageUrlsRef.current);
                setImageUrls([]);

                const finalImages = data.task.files?.final_image || [];
                if (finalImages.length > 0) {
                    setImagesLoading(true);
                    const urls: string[] = [];

                    for (let i = 0; i < finalImages.length; i += 1) {
                        const url = await fetchSharedImageAsBlob(shareId, i + 1);
                        if (url) {
                            urls.push(url);
                        }
                    }

                    setImageUrls(urls);
                    setImagesLoading(false);
                }

                try {
                    const xmlBlob = await sharesApi.downloadSharedFile(shareId, 'final_xml');
                    const xmlString = await xmlBlob.text();
                    if (xmlString) {
                        setRawXml(xmlString);
                    }
                } catch {
                    setRawXml(null);
                }
            } catch (error) {
                console.error('Failed to load share:', error);

                if (error instanceof ApiError) {
                    switch (error.code) {
                        case 'share_not_found':
                            setErrorState({ type: 'not_found', message: error.message });
                            break;
                        case 'share_revoked':
                            setErrorState({ type: 'revoked', message: error.message });
                            break;
                        case 'share_expired':
                            setErrorState({
                                type: 'expired',
                                message: error.message,
                                expiredAt: error.details?.expired_at as string | undefined,
                            });
                            break;
                        default:
                            toast({
                                title: t('loadFailed'),
                                description: error.message,
                                variant: 'destructive',
                            });
                    }
                } else {
                    toast({
                        title: t('loadFailed'),
                        description: t('loadFailedDesc'),
                        variant: 'destructive',
                    });
                }
            } finally {
                setImagesLoading(false);
                setIsLoading(false);
            }
        };

        loadShareData();
    }, [authLoading, isAuthenticated, locale, router, shareId, t, toast]);

    const handleBookmark = async () => {
        setIsSaving(true);
        try {
            await sharesApi.saveShareToCollection(shareId);
            toast({
                title: t('saveSuccessTitle'),
                description: t('saveSuccessDesc', { scoreName: '{scoreName}' }).replace('{scoreName}', scoreTitle),
            });
        } catch (error) {
            toast({
                title: t('saveFailed'),
                description: error instanceof ApiError ? error.message : t('saveFailedDesc'),
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

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
                icon: '馃敆',
                title: t('errorNotFoundTitle'),
                description: t('errorNotFoundDesc'),
                hint: t('hintNotFound'),
            },
            revoked: {
                icon: '馃毇',
                title: t('errorRevokedTitle'),
                description: t('errorRevokedDesc'),
                hint: t('hintRevoked'),
            },
            expired: {
                icon: '鈴?',
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

                <main className="flex-grow flex items-center justify-center py-16">
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
            <main className="flex-grow">
                <div className="max-w-7xl mx-auto px-4 py-16">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                        <div className="lg:col-span-2 space-y-6">
                            <Card className="bg-white rounded-2xl w-full shadow-lg">
                                <CardContent className="p-4">
                                    {imagesLoading ? (
                                        <div className="flex items-center justify-center aspect-[8.5/11] w-full bg-gray-100 rounded-md">
                                            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                                        </div>
                                    ) : imageUrls.length > 0 ? (
                                        <Carousel className="w-full">
                                            <CarouselContent>
                                                {imageUrls.map((url, idx) => (
                                                    <CarouselItem key={idx}>
                                                        <div className="relative aspect-[8.5/11] w-full bg-white rounded-md flex items-center justify-center">
                                                            <img
                                                                src={url}
                                                                alt={`Score Page ${idx + 1}`}
                                                                className="max-w-full max-h-full object-contain rounded-md"
                                                            />
                                                        </div>
                                                    </CarouselItem>
                                                ))}
                                            </CarouselContent>
                                            <CarouselPrevious className="left-2" />
                                            <CarouselNext className="right-2" />
                                        </Carousel>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center aspect-[8.5/11] w-full bg-gray-100 rounded-md">
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
                                        <p className="font-medium">{scoreDifficulty ? tUpload(scoreDifficulty as any) : ''}</p>
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
