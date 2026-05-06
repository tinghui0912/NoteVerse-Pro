
'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { ArrowLeft, PanelLeft, Save, Undo, Redo, Eye, ImageIcon, LoaderCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useState, useRef } from 'react';
import { Footer } from '@/components/layout/footer';
import { OriginalImageViewer } from '@/components/original-image-viewer';
import { getTaskDetails } from '@/lib/api/tasks';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { placeholderImages } from '@/lib/placeholder-images';
import { ListenModal } from '@/components/listen-modal';
import { ShareProvider, useShare } from '@/contexts/share-context';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { EditorProvider } from '@/contexts/editor-provider';
import { useScoreData, useEditorState, useEntityEditor, useHistoryEditor, useHistory, type EditorMode } from '@/contexts/editor-provider';
import { EditorSidebar } from '@/components/editor/editor-sidebar';
import { CardBasedEditor } from '@/components/editor/card-based-editor';
import { ScoreInfoCard } from '@/components/editor/score-info-card';
import { AddEntityModal } from '@/components/add-entity-modal';
import { NoteEditorModal } from '@/components/note-editor-modal';
import { ChordEditorModal } from '@/components/chord-editor-modal';
import type { Note, Rest, Blank, Chord } from '@/types/score-types';
import { AudioPreviewManager } from '@/lib/audio-preview-manager';
import { flattenAllMeasures } from '@/lib/musicxml-flatten';
import { validateDataIntegrity, type ValidationResult } from '@/lib/validator';
import { useToast } from '@/hooks/use-toast';
import { useAutoSave } from '@/hooks/use-auto-save';
import { xmlApi } from '@/lib/api';
import { loadDraft, deleteDraft, type DraftEntry } from '@/lib/draft-storage';
import { DraftRecoveryDialog } from '@/components/draft-recovery-dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const topToolbarItems: { icon: React.ElementType, label: string }[] = [
    { icon: Save, label: 'saveChanges' },
    { icon: Undo, label: 'undo' },
    { icon: Redo, label: 'redo' },
    { icon: ImageIcon, label: 'originalScore' },
];

function EditorPageContent({ id, source, returnUrl }: { id: string; source: 'current' | 'final' | 'enhanced'; returnUrl?: string }) {
    const router = useRouter();
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');
  const tAuth = useTranslations('auth');
  const tb = useBackendMessage();
    const { shareToken } = useShare();
    const {
        scoreData,
        setScoreData,
        rawXml,
        setRawXml,
        currentXml,
        currentXmlRef,
        setCurrentXml,
    } = useScoreData();
    const {
        editorMode,
        editingEntity,
        isAddEntityModalOpen,
        currentAddLocation,
        isImageViewerOpen,
        setIsAddEntityModalOpen,
        setIsImageViewerOpen,
        selectTool,
    } = useEditorState();
    const {
        handleAddEntity,
        handleSelectEntityType,
        handleCloseModal,
        updateEntity,
    } = useEntityEditor();
    const {
        canUndo,
        canRedo,
        handleUndo,
        handleRedo,
    } = useHistoryEditor();
    const { initialize: initializeHistory } = useHistory();

    const [isListenModalOpen, setIsListenModalOpen] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
    const [isValidationDialogOpen, setIsValidationDialogOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // 草稿相关状态
    const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
    const [isDraftDialogOpen, setIsDraftDialogOpen] = useState(false);

    const { toast } = useToast();

    const translateValidationKey = (key: string) => {
        if (!key.includes('.')) {
            return t(key as any);
        }

        const [namespace, ...rest] = key.split('.');
        const nestedKey = rest.join('.');

        switch (namespace) {
            case 'editor':
                return t(nestedKey as any);
            case 'common':
                return tCommon(nestedKey as any);
            case 'validation':
            case 'auth':
                return tAuth(`validation.${nestedKey}` as any);
            default:
                return key;
        }
    };

    // 原始图片 URL 状态
    const [originalImageUrls, setOriginalImageUrls] = useState<{ src: string; alt: string }[]>([]);

    // 自动保存草稿
    const { clearDraft } = useAutoSave(id, currentXml, {
        source,
        returnUrl,
        debounceMs: 3000,
        enabled: !!currentXml
    });


    useEffect(() => {
        const fetchScore = async () => {
            try {
                // 先检测本地草稿
                const draft = await loadDraft(id);

                // 加载服务端 XML
                const xmlString = await xmlApi.loadXml(id, source, shareToken);

                if (draft && xmlString && draft.xml !== xmlString) {
                    // 有草稿且与服务端版本不同，提示用户恢复
                    setPendingDraft(draft);
                    setIsDraftDialogOpen(true);
                    // 先加载服务端版本
                    setRawXml(xmlString);
                    setCurrentXml(xmlString);
                    initializeHistory(xmlString);
                    const { MusicXMLParser } = await import('@/lib/musicxml-parser');
                    const parser = new MusicXMLParser(xmlString);
                    const data = parser.parse();
                    setScoreData(data);
                } else if (xmlString) {
                    // 没有草稿或草稿与服务端相同
                    setRawXml(xmlString);
                    setCurrentXml(xmlString);
                    initializeHistory(xmlString);
                    const { MusicXMLParser } = await import('@/lib/musicxml-parser');
                    const parser = new MusicXMLParser(xmlString);
                    const data = parser.parse();
                    setScoreData(data);
                    // 删除相同的草稿
                    if (draft) await deleteDraft(id);
                } else {
                    setScoreData(null);
                    setRawXml(null);
                }
            } catch (error) {
                console.error("Failed to fetch score XML:", error);
                setLoadError(t('loadFailedHint'));
                setScoreData(null);
                setRawXml(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchScore();
    }, [id, source, setScoreData, setRawXml, setCurrentXml, initializeHistory, toast]);

    // 加载原始图片
    useEffect(() => {
        const loadOriginalImages = async () => {
            try {
                const response = await getTaskDetails(id, shareToken);
                if (response.data?.files?.original_image) {
                    const imageCount = response.data.files.original_image.length;
                    const urls: { src: string; alt: string }[] = [];

                    for (let i = 1; i <= imageCount; i++) {
                        const url = await fetchAuthenticatedImage(id, 'original_image', i, shareToken);
                        if (url) {
                            urls.push({ src: url, alt: t('originalScorePage', { page: i }) });
                        }
                    }

                    setOriginalImageUrls(urls);
                }
            } catch (error) {
                console.error('加载原始图片失败:', error);
            }
        };

        loadOriginalImages();

        // 清理 blob URLs
        return () => {
            originalImageUrls.forEach(img => URL.revokeObjectURL(img.src));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const handleSaveChanges = () => {
        // 执行校验
        const result = validateDataIntegrity(scoreData, currentXml, translateValidationKey);

        if (!result.success) {
            // 有错误，显示错误弹窗
            setValidationResult(result);
            setIsValidationDialogOpen(true);
            return;
        }

        if (result.warnings.length > 0) {
            // 有警告，显示警告弹窗，让用户选择
            setValidationResult(result);
            setIsValidationDialogOpen(true);
            return;
        }

        // 校验通过，执行保存
        performSave();
    };

    const performSave = async () => {
        if (!currentXml) return;

        setIsSaving(true);
        try {
            if (source === 'current') {
                // 从 /review 来的编辑 → 保存为 current_xml → 更新 preview_image → 跳回 /review
                await xmlApi.saveXmlContent(id, currentXml, 'current_xml', 'preview_image');
                await clearDraft();  // 保存成功后清除草稿
                toast({
                    title: tCommon('savingSuccess'),
                    description: tCommon('scoreSaved'),
                });
                router.push(returnUrl || `/review/${id}`);
            } else {
                // 从 /results 或 /share 来的编辑（source=final）→ 保存为 final_xml → 更新 final_image → 跳到指定页面
                await xmlApi.saveXmlContent(id, currentXml, 'final_xml', 'final_image', 300);
                await clearDraft();  // 保存成功后清除草稿
                toast({
                    title: tCommon('savingSuccess'),
                    description: tCommon('scoreSaved'),
                });
                router.push(returnUrl || `/results/${id}`);
            }
        } catch (error) {
            console.error('保存失败:', error);
            toast({
                title: t('saveFailed'),
                description: t('saveFailedDesc'),
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleIgnoreWarningsAndSave = () => {
        setIsValidationDialogOpen(false);
        setValidationResult(null);
        performSave();
    };

    // 恢复草稿
    const handleRecoverDraft = async () => {
        if (pendingDraft) {
            setCurrentXml(pendingDraft.xml);
            initializeHistory(pendingDraft.xml);
            const { MusicXMLParser } = await import('@/lib/musicxml-parser');
            const parser = new MusicXMLParser(pendingDraft.xml);
            const data = parser.parse();
            setScoreData(data);
            toast({
                title: t('draftRecovered'),
                description: t('draftRecoveredDesc'),
            });
        }
        setPendingDraft(null);
    };

    // 放弃草稿
    const handleDiscardDraft = async () => {
        await deleteDraft(id);
        setPendingDraft(null);
        toast({
            title: t('draftDiscarded'),
            description: t('draftDiscardedDesc'),
        });
    };

    const handleToolbarClick = (label: string) => {
        if (label === 'saveChanges') {
            handleSaveChanges();
        } else if (label === 'originalScore') {
            setIsImageViewerOpen(prev => !prev); // toggle
        }
    };

    const handlePreviewClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!currentXml) {
            console.error("No XML content to preview.");
            return;
        }
        setIsListenModalOpen(true);
    };

    // 合并声部功能
    const handleMergeParts = async () => {
        if (!currentXml) return;

        try {
            const flattenedXml = flattenAllMeasures(currentXml);
            setCurrentXml(flattenedXml);
            initializeHistory(flattenedXml); // 重新初始化历史记录

            // 重新解析 XML
            const { MusicXMLParser } = await import('@/lib/musicxml-parser');
            const parser = new MusicXMLParser(flattenedXml);
            setScoreData(parser.parse());
        } catch (error) {
            console.error('Failed to merge parts:', error);
        }
    };


    const isNoteModalOpen = editingEntity !== null && (editingEntity.type === 'note' || editingEntity.type === 'rest' || editingEntity.type === 'blank');
    const isChordModalOpen = editingEntity !== null && editingEntity.type === 'chord';

    const getVoiceNameForModal = () => {
        if (!currentAddLocation || !scoreData) return '';
        const stave = scoreData.measures[currentAddLocation.measureIndex]?.staves[currentAddLocation.staveIndex];
        if (!stave) return '';
        // xmlVoice 是 1-based，查找 voice name 中包含对应数字的 voice
        const voice = stave.voices.find(v => v.name.includes(`${currentAddLocation.xmlVoice}`));
        if (!voice) return '';
        const [key, num] = voice.name.split(' ');
        return `${t(key as any)} ${num}`;
    }

    // 加载中状态
    if (isLoading) {
        return (
            <div className="bg-gray-50 min-h-screen flex flex-col">
                <div className="bg-gray-900">
                    <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
                        <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
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
    if (loadError) {
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
                        <p className="text-gray-600 mb-2">{loadError}</p>
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

            <div className="flex-grow flex flex-col">
                <header className="sticky top-0 z-20 h-16 shrink-0 border-b bg-background/80 backdrop-blur-sm">
                    <div className="max-w-7xl mx-auto flex h-full items-center justify-between px-4">
                        <div className="flex items-center gap-2">
                            <Sheet>
                                <SheetTrigger asChild>
                                    <Button variant="ghost" size="icon" className="md:hidden">
                                        <PanelLeft className="h-5 w-5" />
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="left" className="w-72 bg-white/80 backdrop-blur-sm rounded-r-2xl p-4">
                                    <SheetHeader className="sr-only">
                                        <SheetTitle>Editor Tools</SheetTitle>
                                    </SheetHeader>
                                    <div className="overflow-y-auto h-full pt-12 hide-scrollbar">
                                        <EditorSidebar editorMode={editorMode} onToolSelect={selectTool} onMergeParts={handleMergeParts} />
                                    </div>
                                </SheetContent>
                            </Sheet>
                        </div>
                        <div className="flex items-center gap-2">
                            <TooltipProvider>
                                {topToolbarItems.map((item) => {
                                    // 根据按钮类型设置 onClick 和 disabled
                                    const isUndo = item.label === 'undo';
                                    const isRedo = item.label === 'redo';
                                    const isOriginalScore = item.label === 'originalScore';
                                    const isSaveChanges = item.label === 'saveChanges';

                                    const handleClick = isUndo ? handleUndo
                                        : isRedo ? handleRedo
                                            : isOriginalScore ? () => setIsImageViewerOpen(prev => !prev)
                                                : isSaveChanges ? handleSaveChanges
                                                    : undefined;

                                    const isDisabled = isUndo ? !canUndo : isRedo ? !canRedo : false;

                                    return (
                                        <Tooltip key={item.label}>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleClick}
                                                    disabled={isDisabled}
                                                >
                                                    <item.icon className="h-5 w-5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>{t(item.label as any)}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    );
                                })}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" onClick={handlePreviewClick} disabled={isPreviewLoading}>
                                            {isPreviewLoading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Eye className="h-5 w-5" />}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{t('livePreview')}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>
                </header>

                <main className="flex-grow">
                    <div className="max-w-7xl mx-auto px-4 pt-8 pb-16">
                        {scoreData ? (
                            <div className="flex items-start gap-8">
                                <aside className="hidden md:block md:w-64 md:shrink-0 sticky top-24 h-[calc(100vh-8.5rem)]">
                                    <div className="h-full overflow-hidden rounded-2xl bg-white/80 backdrop-blur-sm shadow-lg">
                                        <div className="h-full overflow-y-auto p-4 hide-scrollbar">
                                            <EditorSidebar editorMode={editorMode} onToolSelect={selectTool} onMergeParts={handleMergeParts} />
                                        </div>
                                    </div>
                                </aside>

                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-col gap-4">
                                        <ScoreInfoCard />
                                        <CardBasedEditor />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-20">
                                <p>Loading score...</p>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            <Footer />
            <OriginalImageViewer
                images={originalImageUrls}
                isOpen={isImageViewerOpen}
                onClose={() => setIsImageViewerOpen(false)}
            />
            <ListenModal
                isOpen={isListenModalOpen}
                onOpenChange={setIsListenModalOpen}
                xmlString={currentXmlRef.current || currentXml}
            />
            <AddEntityModal
                isOpen={isAddEntityModalOpen}
                onClose={() => setIsAddEntityModalOpen(false)}
                onSelect={handleSelectEntityType}
                voiceName={getVoiceNameForModal()}
            />
            {editingEntity && isNoteModalOpen && (
                <NoteEditorModal
                    isOpen={isNoteModalOpen}
                    onClose={handleCloseModal}
                    onSave={(result) => {
                        // 使用 spread 操作符自动包含 result 中的所有字段
                        updateEntity({
                            ...editingEntity,
                            ...result,
                        } as Note | Rest | Blank);
                    }}
                    note={editingEntity as Note | Rest | Blank}
                />
            )}
            {editingEntity && isChordModalOpen && (
                <ChordEditorModal
                    isOpen={isChordModalOpen}
                    onClose={handleCloseModal}
                    onSave={(result) => {
                        // 使用 spread 操作符自动包含 result 中的所有字段
                        updateEntity({
                            ...editingEntity,
                            ...result,
                        } as Chord);
                    }}
                    chord={editingEntity as Chord}
                />
            )}

            {/* 校验结果弹窗 */}
            <AlertDialog open={isValidationDialogOpen} onOpenChange={setIsValidationDialogOpen}>
                <AlertDialogContent className="max-w-lg max-h-[85vh] flex flex-col">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            {validationResult?.success ? (
                                <>
                                    <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                    <span>{tAuth('validation.warning')}</span>
                                </>
                            ) : (
                                <>
                                    <XCircle className="h-5 w-5 text-destructive" />
                                    <span>{tAuth('validation.failed')}</span>
                                </>
                            )}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3 text-left overflow-y-auto max-h-[50vh] pr-2 custom-scrollbar">
                                {/* 错误列表 */}
                                {validationResult?.issues && validationResult.issues.length > 0 && (
                                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                                        <p className="font-medium text-destructive text-sm mb-2">
                                            {(tAuth('validation.foundIssues') as string).replace('{count}', String(validationResult.issues.length))}
                                        </p>
                                        <ul className="space-y-1 text-xs">
                                            {validationResult.issues.map((issue, index) => (
                                                <li key={index} className="text-destructive/80 pl-3 border-l-2 border-destructive/30">
                                                    {issue}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* 警告列表 */}
                                {validationResult?.warnings && validationResult.warnings.length > 0 && (
                                    <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                                        <p className="font-medium text-yellow-600 text-sm mb-2">
                                            {(tAuth('validation.foundWarnings') as string).replace('{count}', String(validationResult.warnings.length))}
                                        </p>
                                        <ul className="space-y-1 text-xs max-h-40 overflow-y-auto custom-scrollbar">
                                            {validationResult.warnings.map((warning, index) => (
                                                <li key={index} className="text-yellow-600/80 pl-3 border-l-2 border-yellow-500/30">
                                                    {warning}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* 说明文字 */}
                                <p className="text-sm text-muted-foreground">
                                    {validationResult?.success
                                        ? tAuth('validation.warningDescription')
                                        : tAuth('validation.errorDescription')
                                    }
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-4 shrink-0">
                        <AlertDialogCancel className="border-muted-foreground/20">{tCommon('goBack')}</AlertDialogCancel>
                        {/* 只有警告时才显示"忽略并继续"按钮 */}
                        {validationResult?.success && validationResult?.warnings?.length > 0 && (
                            <AlertDialogAction
                                onClick={handleIgnoreWarningsAndSave}
                            >
                                {tAuth('validation.ignoreAndSave')}
                            </AlertDialogAction>
                        )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* 草稿恢复弹窗 */}
            <DraftRecoveryDialog
                open={isDraftDialogOpen}
                onOpenChange={setIsDraftDialogOpen}
                draft={pendingDraft}
                onRecover={handleRecoverDraft}
                onDiscard={handleDiscardDraft}
            />
        </div>
    );
}

// This is the new Client Component part
export default function EditorPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;

    // 从 URL 读取 source 参数，默认为 'current'
    const sourceParam = searchParams.get('source');
    const source = (sourceParam === 'final' || sourceParam === 'enhanced' || sourceParam === 'current')
        ? sourceParam
        : 'current';

    // 从 URL 读取 returnUrl 参数（用于保存后跳转）
    const returnUrl = searchParams.get('returnUrl') || undefined;

    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ShareProvider>
                <EditorProvider>
                    {id ? <EditorPageContent id={id} source={source} returnUrl={returnUrl} /> : <div>Invalid ID</div>}
                </EditorProvider>
            </ShareProvider>
        </Suspense>
    );
}
