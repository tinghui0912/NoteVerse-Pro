
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Edit, Hand, Gamepad2, Copy, ArrowLeft, MoreVertical, Link as LinkIcon, Link2Off, Undo, Trash2, Play, Save, FileImage, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { useToast } from '@/hooks/use-toast';
import React, { useState, useRef, useEffect, Suspense } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ListenModal } from '@/components/listen-modal';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Footer } from '@/components/layout/footer';
import { EditorProvider } from '@/contexts/editor-provider';
import { useScoreData } from '@/contexts/editor-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTaskDetail, useUpdateTask } from '@/hooks/queries/use-task-queries';
import { useShareList, useCreateShare, useToggleShare, useDeleteShare } from '@/hooks/queries/use-share-queries';
import { useXmlContent, useGenerateFingering } from '@/hooks/queries/use-xml-queries';
import { queryKeys } from '@/lib/query-client';
import type { Share } from '@/types/api';
import { Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useDownload } from '@/hooks/use-download';


// 绉婚櫎 mock 鍥剧墖锛屼娇鐢ㄧ湡瀹炴暟鎹?
type ShareStatus = 'active' | 'revoked' | 'expired';
type SharePermission = 'view' | 'edit';

// 浣跨敤鐪熷疄鏁版嵁
interface ShareItem {
  id: string;
  url: string;
  date: string;
  permission: SharePermission;
  status: ShareStatus;
  expires: string;
  token: string;
}

const statusConfig: Record<ShareStatus, { labelKey: string; icon: React.ElementType }> = {
  active: { labelKey: 'statusActive', icon: LinkIcon },
  revoked: { labelKey: 'statusRevoked', icon: Link2Off },
  expired: { labelKey: 'statusExpired', icon: Link2Off },
}

function ResultsPageContent({ id }: { id: string }) {
  const t = useTranslations('results');
  const tCommon = useTranslations('common');
  const tShare = useTranslations('share');
  const tHistory = useTranslations('history');
  const tUpload = useTranslations('upload');
  const tPractice = useTranslations('practice');
  const tErrors = useTranslations('errors');
  const { toast } = useToast();
  const router = useRouter();
  const [scoreTitle, setScoreTitle] = useState('');
  const [scoreDifficulty, setScoreDifficulty] = useState('');
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isListenModalOpen, setIsListenModalOpen] = useState(false);
  const [sharePermission, setSharePermission] = useState('view');
  const [shareExpiration, setShareExpiration] = useState('7d');
  const queryClient = useQueryClient();
  const imageUrlsRef = useRef<string[]>([]);

  const { rawXml, setRawXml, setScoreData } = useScoreData();

  // 1. TanStack Query锛氫换鍔¤鎯?
  const { data: taskResponse, isLoading: isTaskLoading, error: taskError } = useTaskDetail(id);
  const task = taskResponse?.data;

  // 褰撲换鍔℃暟鎹姞杞芥垨閫€鍑虹紪杈戠姸鎬佹椂锛屽悓姝ユ爣棰樺拰闅惧害
  useEffect(() => {
    if (task && !isEditingInfo) {
      setScoreTitle(task.title || '');
      setScoreDifficulty(task.difficulty || '');
    }
  }, [task, isEditingInfo]);

  // 2. TanStack Query锛氬浘鐗囬鍔犺浇
  const finalImages = task?.files?.final_image || [];
  const { data: imageUrls = [], isLoading: imagesLoading } = useQuery({
    queryKey: queryKeys.images.task(id, 'final_image'),
    queryFn: async () => {
      const urls: string[] = [];
      for (let i = 0; i < finalImages.length; i++) {
        const url = await fetchAuthenticatedImage(id, 'final_image', i + 1);
        if (url) urls.push(url);
      }
      return urls;
    },
    enabled: !!task && finalImages.length > 0,
    staleTime: Infinity,
    gcTime: 0,
  });

  // 娓呯悊鍥剧墖 URLs
  useEffect(() => {
    imageUrlsRef.current = imageUrls;
  }, [imageUrls]);

  useEffect(() => {
    return () => {
      imageUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // 3. TanStack Query锛歑ML 鍔犺浇涓庤В鏋?
  const { data: xmlContent } = useXmlContent(id, 'final', { enabled: !!task });
  useEffect(() => {
    if (xmlContent) {
      setRawXml(xmlContent);
      import('@/lib/musicxml-parser').then(({ MusicXMLParser }) => {
        try {
          const parser = new MusicXMLParser(xmlContent);
          const data = parser.parse();
          setScoreData(data);
          // 鍙湁褰撲换鍔℃湰韬病鏈夋爣棰橈紝涓斾笉鍦ㄧ紪杈戠姸鎬佹椂锛屾墠浣跨敤瑙ｆ瀽鍑虹殑鏍囬
          if (data.mainTitle && !isEditingInfo && !task?.title) {
            setScoreTitle(data.mainTitle);
          }
        } catch (e) {
          console.error('Failed to parse XML', e);
        }
      });
    }
  }, [xmlContent, setRawXml, setScoreData, isEditingInfo, task?.title]);

  // 4. TanStack Query锛氬垎浜垪琛?
  const { data: sharesResponse } = useShareList(id);
  const historicalShares: ShareItem[] = React.useMemo(() => {
    if (!sharesResponse?.data?.shares) return [];
    return sharesResponse.data.shares.map((s: Share) => ({
      id: String(s.id),
      url: `/share/${s.share_token}`,
      date: s.created_at || '',
      permission: 'view' as SharePermission,
      status: s.revoked_at ? 'revoked' : (s.expires_at && new Date(s.expires_at) < new Date() ? 'expired' : 'active') as ShareStatus,
      expires: s.expires_at || '',
      token: s.share_token,
    }));
  }, [sharesResponse]);

  // 鍚堝苟 loading 鍜?error 鐘舵€?
  const isLoading = isTaskLoading;
  const error = taskError instanceof ApiError && taskError.code ? tErrors(taskError.code as never) : (taskError instanceof Error ? taskError.message : null);

  // ============ Mutations ============
  const updateTaskMutation = useUpdateTask();
  const createShareMutation = useCreateShare(id);
  const toggleShareMutation = useToggleShare(id);
  const deleteShareMutation = useDeleteShare(id);
  const generateFingeringMutation = useGenerateFingering();

  const handleToggleEditInfo = () => {
    if (isEditingInfo) {
      // 淇濆瓨缂栬緫
      if (scoreTitle.trim() === '') {
        toast({
          variant: "destructive",
          title: t('nameEmptyTitle'),
          description: t('nameEmptyDesc'),
        });
        return;
      }

      updateTaskMutation.mutate(
        { id, data: { title: scoreTitle, difficulty: scoreDifficulty } },
        {
          onSuccess: () => {
            toast({
              title: t('saveSuccess'),
              description: t('scoreInfoUpdated'),
            });
            setIsEditingInfo(false);
          },
          onError: (error) => {
            toast({
              variant: "destructive",
              title: t('saveFailed'),
              description: error instanceof Error ? error.message : t('saveFailedDesc'),
            });
          }
        }
      );
    } else {
      setIsEditingInfo(true);
    }
  };

  const handleCopy = (text: string | undefined, message: string) => {
    if (!text) {
      toast({
        title: t('copyFailed'),
        description: t('linkUnavailable'),
        variant: 'destructive',
      });
      return;
    }
    // 濡傛灉鏄浉瀵硅矾寰勶紝鑷姩鎷兼帴瀹屾暣 URL
    const fullUrl = text.startsWith('/') ? `${window.location.origin}${text}` : text;
    navigator.clipboard.writeText(fullUrl);
    toast({
      title: tCommon('copied'),
      description: message,
    });
  };

  // 鍒涘缓鍒嗕韩閾炬帴
  const handleCreateShare = () => {
    const expirationDays = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
      '365d': 365,
      'perm': 999,
    }[shareExpiration] || 7;

    createShareMutation.mutate(
      { expiresInDays: expirationDays },
      {
        onSuccess: (response) => {
          toast({
            title: t('createShareSuccess'),
            description: t('shareLinkCreated'),
          });
          // 鍓嶇鑷繁鎷兼帴瀹屾暣閾炬帴
          if (response.data) {
            const shareUrl = `${window.location.origin}/share/${response.data.share_token}`;
            navigator.clipboard.writeText(shareUrl);
          }
        },
        onError: (error) => {
          toast({
            title: t('createShareFailed'),
            description: error instanceof ApiError && error.code ? tErrors(error.code as never) : t('createShareFailedDesc'),
            variant: 'destructive',
          });
        }
      }
    );
  };

  // 澶勭悊鍒嗕韩鎿嶄綔
  const handleShareAction = (shareId: string, action: 'revoke' | 'reinstate' | 'delete') => {
    const share = historicalShares.find(s => s.id === shareId);
    if (!share) return;

    if (action === 'delete') {
      deleteShareMutation.mutate(share.token, {
        onSuccess: () => {
          toast({
            title: t('deleteShareSuccess'),
            description: t('shareLinkDeleted'),
          });
        },
        onError: (error) => {
          toast({
            title: t('operationFailed'),
            description: error instanceof ApiError ? error.message : t('operationFailed'),
            variant: 'destructive',
          });
        }
      });
    } else if (action === 'revoke' || action === 'reinstate') {
      toggleShareMutation.mutate(share.token, {
        onSuccess: (response) => {
          if (response.data) {
            toast({
              title: response.data.revoked ? t('revoked') : t('reinstated'),
              description: response.data.revoked ? t('shareLinkRevoked') : t('shareLinkReinstated'),
            });
          }
        },
        onError: (error) => {
          toast({
            title: t('operationFailed'),
            description: error instanceof ApiError ? error.message : t('operationFailed'),
            variant: 'destructive',
          });
        }
      });
    }
  };

  // 鐢熸垚鎸囨硶
  const handleGenerateFingering = () => {
    generateFingeringMutation.mutate(
      { taskId: id },
      {
        onSuccess: (response) => {
          if (response.success) {
            toast({
              title: t('fingeringSuccess'),
              description: t('fingeringDesc'),
            });
            // 鍒锋柊椤甸潰浠ュ姞杞芥柊鐨勬寚娉曠粨鏋?            queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
            queryClient.invalidateQueries({ queryKey: queryKeys.images.task(id, 'final_image') });
            queryClient.invalidateQueries({ queryKey: queryKeys.xml.content(id, 'final') });
          } else {
            toast({
              title: t('fingeringFailed'),
              description: response.message || t('fingeringFailed'),
              variant: 'destructive',
            });
          }
        },
        onError: (error) => {
          toast({
            title: t('fingeringFailed'),
            description: error instanceof ApiError && error.code ? tErrors(error.code as never) : t('fingeringFailedDesc'),
            variant: 'destructive',
          });
        }
      }
    );
  };

  // 浣跨敤閫氱敤涓嬭浇 Hook
  const { handleDownload } = useDownload({
    mode: 'task',
    id,
    imageCount: imageUrls.length,
  });

  const actionButtons = [
    {
      label: t('generateFingering'),
      icon: Hand,
      href: '#',
      isAction: true,
      onClick: handleGenerateFingering,
      loading: generateFingeringMutation.isPending,
    },
    { label: tCommon('play'), icon: Play, href: '#', isModal: true },
    { label: tPractice('mode'), icon: Gamepad2, href: `/practice/${id}` },
    { label: tCommon('edit'), icon: Edit, href: `/editor/${id}?source=final` },
  ];

  // 鍔犺浇涓姸鎬?
  if (isLoading) {
    return (
      <div className="bg-gray-50 min-h-screen flex flex-col">
        <div className="bg-gray-900">
          <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
            <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          </div>
        </div>
        <main className="grow flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-orange-500 mx-auto mb-4" />
            <p className="text-gray-600">{tCommon('loading')}</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // 閿欒鐘舵€?
  if (error) {
    return (
      <div className="bg-gray-50 min-h-screen flex flex-col">
        <div className="bg-gray-900">
          <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
            <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          </div>
        </div>
        <main className="grow flex items-center justify-center py-16">
          <div className="max-w-md w-full mx-4 text-center">
            <div className="text-6xl mb-6">鈿狅笍</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">{tCommon('loadFailed')}</h2>
            <p className="text-gray-600 mb-2">{error}</p>
            <p className="text-gray-500 text-sm mb-8">{t('loadFailedHint')}</p>
            <Button asChild className="px-8">
              <Link href="/history">{t('backToHistory')}</Link>
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
              <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
              <p className="text-lg text-gray-300">{t('subtitle')}</p>
            </div>
            <div className="w-12 shrink-0" />
          </div>
        </div>
      </div>

      <main className="grow">
        <div className="max-w-7xl mx-auto px-4 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Left Column */}
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
                      <p className="text-gray-500 text-sm">{t('noImageAvailable')}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {actionButtons.map(btn => {
                  const IconComponent = btn.icon;
                  const isLoading = 'loading' in btn && btn.loading;

                  const buttonContent = (
                    <div className="flex flex-col items-center justify-center h-full">
                      {isLoading ? (
                        <Loader2 className="h-6 w-6 mb-2 animate-spin" />
                      ) : (
                        <IconComponent className="h-6 w-6 mb-2" />
                      )}
                      <span>{btn.label}</span>
                    </div>
                  );

                  // 甯?onClick 鐨勬寜閽?
                  if ('isAction' in btn && btn.isAction && 'onClick' in btn) {
                    return (
                      <Button
                        key={btn.label}
                        variant="outline"
                        className="h-24 rounded-2xl bg-white w-full"
                        onClick={btn.onClick}
                        disabled={isLoading}
                      >
                        {buttonContent}
                      </Button>
                    );
                  }

                  // Modal 鎸夐挳
                  if ('isModal' in btn && btn.isModal) {
                    return (
                      <React.Fragment key={btn.label}>
                        <Button
                          variant="outline"
                          className="h-24 rounded-2xl bg-white w-full"
                          onClick={() => setIsListenModalOpen(true)}
                        >
                          {buttonContent}
                        </Button>
                        <ListenModal isOpen={isListenModalOpen} onOpenChange={setIsListenModalOpen} xmlString={rawXml} />
                      </React.Fragment>
                    );
                  }

                  // 鏅€氶摼鎺ユ寜閽?
                  return (
                    <Link key={btn.label} href={btn.href} passHref>
                      <Button variant="outline" className="h-24 rounded-2xl bg-white w-full">
                        {buttonContent}
                      </Button>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right Column */}
            <div className="lg:col-span-1 space-y-6 sticky top-8">
              <Card className="bg-white rounded-2xl shadow-lg">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t('scoreInfo')}</CardTitle>
                  <div className="flex gap-1">
                    {isEditingInfo && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => {
                          // 鍙栨秷缂栬緫锛屾仮澶嶅師鍊?
                          if (task) {
                            setScoreTitle(task.title || '');
                            setScoreDifficulty(task.difficulty || '');
                          }
                          setIsEditingInfo(false);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={handleToggleEditInfo}
                      disabled={updateTaskMutation.isPending}
                    >
                      {updateTaskMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditingInfo ? <Save className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center text-sm gap-4">
                    <Label htmlFor="score-title" className="text-muted-foreground shrink-0">{t('scoreName')}</Label>
                    {isEditingInfo ? (
                      <Input
                        id="score-title"
                        value={scoreTitle}
                        onChange={(e) => setScoreTitle(e.target.value)}
                        maxLength={30}
                        className="h-8 flex-1 min-w-0 text-sm bg-white"
                      />
                    ) : (
                      <span className="font-medium text-sm text-right truncate flex-1">{scoreTitle}</span>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-sm gap-4">
                    <Label className="text-muted-foreground shrink-0">{t('scoreDifficulty')}</Label>
                    {isEditingInfo ? (
                      <Select
                        value={scoreDifficulty}
                        onValueChange={setScoreDifficulty}
                      >
                        <SelectTrigger className="h-8 flex-1 min-w-0 text-sm bg-white w-auto gap-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="difficultyBeginner">{tUpload('difficultyBeginner')}</SelectItem>
                          <SelectItem value="difficultyIntermediate">{tUpload('difficultyIntermediate')}</SelectItem>
                          <SelectItem value="difficultyAdvanced">{tUpload('difficultyAdvanced')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-medium text-sm text-right truncate flex-1">
                        {scoreDifficulty ? tUpload(scoreDifficulty as never) : ''}
                      </span>
                    )}
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
                  >
                    <Download className="mr-2 h-4 w-4" /> {t('downloadImage')}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start bg-white"
                    onClick={() => handleDownload('xml')}
                  >
                    <Download className="mr-2 h-4 w-4" /> {t('downloadMusicXML')}
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white rounded-2xl shadow-lg">
                <CardHeader>
                  <CardTitle>{tShare('createShare')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="share-permission">{tShare('permission')}</Label>
                    <Select value={sharePermission} onValueChange={setSharePermission}>
                      <SelectTrigger id="share-permission" className="bg-white">
                        <SelectValue placeholder={t('selectPermissionPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="view">{tShare('viewOnly')}</SelectItem>
                        <SelectItem value="edit">{tShare('canEdit')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="share-expiration">{tShare('expiration')}</Label>
                    <Select value={shareExpiration} onValueChange={setShareExpiration}>
                      <SelectTrigger id="share-expiration" className="bg-white">
                        <SelectValue placeholder={t('selectExpirationPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1d">{tShare('1day')}</SelectItem>
                        <SelectItem value="7d">{tShare('7days')}</SelectItem>
                        <SelectItem value="30d">{tShare('30days')}</SelectItem>
                        <SelectItem value="365d">{tShare('365days')}</SelectItem>
                        <SelectItem value="perm">{tShare('permanent')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full rounded-full"
                    onClick={handleCreateShare}
                    disabled={createShareMutation.isPending}
                  >
                    {createShareMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      tShare('createLink')
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white rounded-2xl shadow-lg">
                <CardHeader>
                  <CardTitle>{tShare('historicalShares')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-72 w-full">
                    <div className="space-y-3 pr-4">
                      {historicalShares.length > 0 ? (
                        historicalShares.map(share => {
                          const config = statusConfig[share.status];
                          const isActive = share.status === 'active';
                          const permissionText = share.permission === 'view' ? tShare('viewOnly') : tShare('canEdit');
                          return (
                            <div
                              key={share.id}
                              className={cn(
                                "flex items-start p-3 rounded-lg border transition-opacity",
                                isActive ? 'bg-orange-50 border-orange-200' : 'bg-secondary border-border opacity-60'
                              )}
                            >
                              <config.icon className={cn(
                                "h-5 w-5 mr-3 mt-0.5 shrink-0",
                                isActive ? 'text-orange-500' : 'text-muted-foreground'
                              )} />
                              <div className="flex-1 text-sm overflow-hidden space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className={cn(
                                    "font-medium",
                                    isActive ? 'text-orange-600' : 'text-muted-foreground'
                                  )}>{permissionText}</p>
                                  <Badge variant="outline" className={cn(
                                    "shrink-0",
                                    isActive ? 'border-orange-300 text-orange-600' : 'border-border text-muted-foreground'
                                  )}>{tHistory(config.labelKey as never)}</Badge>
                                </div>
                                <p className={cn("text-xs", isActive ? 'text-orange-500/80' : 'text-muted-foreground')}>
                                  {tHistory('createdAt')}: {share.date}
                                </p>
                                <p className={cn("text-xs", isActive ? 'text-orange-500/80' : 'text-muted-foreground')}>
                                  {tHistory('expiresAt')}: {share.expires}
                                </p>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className={cn(
                                    "h-8 w-8 shrink-0 -mr-1.5 -mt-1.5",
                                    isActive ? 'text-orange-500 hover:bg-orange-100' : 'text-muted-foreground hover:bg-secondary',
                                    !isActive && 'focus-visible:ring-muted-foreground'
                                  )}>
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleCopy(share.url, `${tShare('copyShareLink')} (${share.date})`)}>
                                    <Copy className="mr-2 h-4 w-4" />
                                    <span>{tShare('copyLink')}</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {share.status === 'active' && (
                                    <DropdownMenuItem onClick={() => handleShareAction(share.id, 'revoke')}>
                                      <Link2Off className="mr-2 h-4 w-4" />
                                      <span>{tShare('revoke')}</span>
                                    </DropdownMenuItem>
                                  )}
                                  {share.status === 'revoked' && (
                                    <DropdownMenuItem onClick={() => handleShareAction(share.id, 'reinstate')}>
                                      <Undo className="mr-2 h-4 w-4" />
                                      <span>{tShare('reinstate')}</span>
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleShareAction(share.id, 'delete')}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    <span>{tHistory('deleteRecord')}</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )
                        })
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">{t('noHistoricalShares')}</p>
                      )}
                    </div>
                  </ScrollArea>
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

export default function ResultsPageWithProvider({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id } = resolvedParams;
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EditorProvider>
        <ResultsPageContent id={id} />
      </EditorProvider>
    </Suspense>
  );
}
