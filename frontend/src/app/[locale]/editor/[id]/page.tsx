
'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { ArrowLeft, PanelLeft, Save, Undo, Redo, Eye, ImageIcon, LoaderCircle, XCircle, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';
import { Footer } from '@/components/layout/footer';
import { OriginalImageViewer } from '@/components/original-image-viewer';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { ListenModal } from '@/components/listen-modal';
import { ShareProvider, useShare } from '@/contexts/share-context';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { EditorProvider } from '@/contexts/editor-provider';
import { useScoreData, useEditorState, useEntityEditor, useHistoryEditor, useHistory } from '@/contexts/editor-provider';
import { EditorSidebar } from '@/components/editor/editor-sidebar';
import { CardBasedEditor } from '@/components/editor/card-based-editor';
import { ScoreInfoCard } from '@/components/editor/score-info-card';
import { AddEntityModal } from '@/components/add-entity-modal';
import { NoteEditorModal } from '@/components/note-editor-modal';
import { ChordEditorModal } from '@/components/chord-editor-modal';
import type { Note, Rest, Blank, Chord } from '@/types/score-types';
import { flattenAllMeasures } from '@/lib/musicxml-flatten';
import { validateDataIntegrity, type ValidationResult } from '@/lib/validator';
import { useToast } from '@/hooks/use-toast';
import { useAutoSave } from '@/hooks/use-auto-save';
import { loadDraft, deleteDraft, type DraftEntry } from '@/lib/draft-storage';
import { useTaskDetail } from '@/hooks/queries/use-task-queries';
import { useXmlContent, useSaveXml } from '@/hooks/queries/use-xml-queries';
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
    const { shareToken } = useShare();
    const {
        scoreData,
        setScoreData,
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
    const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
    const [isValidationDialogOpen, setIsValidationDialogOpen] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // Queries
    const { data: xmlString, isLoading: isXmlLoading, error: xmlError } = useXmlContent(id, source, { shareToken });
    const { data: taskData, isLoading: isTaskLoading } = useTaskDetail(id, { shareToken });
    const saveXmlMutation = useSaveXml();

    // 鑽夌鐩稿叧鐘舵€?
    const [pendingDraft, setPendingDraft] = useState<DraftEntry | null>(null);
    const [isDraftDialogOpen, setIsDraftDialogOpen] = useState(false);

    const { toast } = useToast();

    const translateValidationKey = (key: string) => {
        if (!key.includes('.')) {
            return t(key as never);
        }

        const [namespace, ...rest] = key.split('.');
        const nestedKey = rest.join('.');

        switch (namespace) {
            case 'editor':
                return t(nestedKey as never);
            case 'common':
                return tCommon(nestedKey as never);
            case 'validation':
            case 'auth':
                return tAuth(`validation.${nestedKey}` as never);
            default:
                return key;
        }
    };

    // 鍘熷鍥剧墖 URL 鐘舵€?
    const [originalImageUrls, setOriginalImageUrls] = useState<{ src: string; alt: string }[]>([]);

    // 鑷姩淇濆瓨鑽夌
    const { clearDraft, isSaving: isAutoSaving } = useAutoSave(id, currentXml, {
        source,
        returnUrl,
        debounceMs: 3000,
        enabled: !!currentXml
    });


    useEffect(() => {
        const initScore = async () => {
            if (!xmlString || isInitialized) return;

            try {
                // 鍏堟娴嬫湰鍦拌崏绋?
                const draft = await loadDraft(id);

                if (draft && draft.xml !== xmlString) {
                    // 鏈夎崏绋夸笖涓庢湇鍔＄鐗堟湰涓嶅悓锛屾彁绀虹敤鎴锋仮澶?
                    setPendingDraft(draft);
                    setIsDraftDialogOpen(true);
                } else if (draft) {
                    // 鑽夌涓庢湇鍔＄鐩稿悓锛岀洿鎺ュ垹闄よ崏绋?
                    await deleteDraft(id);
                }

                // 鍔犺浇鏈嶅姟绔増鏈?
                setRawXml(xmlString);
                setCurrentXml(xmlString);
                initializeHistory(xmlString);
                const { MusicXMLParser } = await import('@/lib/musicxml-parser');
                const parser = new MusicXMLParser(xmlString);
                const data = parser.parse();
                setScoreData(data);
            } catch (error) {
                console.error("Failed to parse score XML:", error);
                setLoadError(t('loadFailedHint'));
                setScoreData(null);
                setRawXml(null);
            } finally {
                setIsInitialized(true);
            }
        };

        if (xmlError) {
            setLoadError(t('loadFailedHint'));
            setScoreData(null);
            setRawXml(null);
            setIsInitialized(true);
        } else {
            initScore();
        }
    }, [xmlString, xmlError, id, setScoreData, setRawXml, setCurrentXml, initializeHistory, isInitialized, t]);

    // 鍔犺浇鍘熷鍥剧墖
    useEffect(() => {
        const loadOriginalImages = async () => {
            try {
                if (taskData?.data?.files?.original_image) {
                    const imageCount = taskData.data.files.original_image.length;
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
                console.error('鍔犺浇鍘熷鍥剧墖澶辫触:', error);
            }
        };

        if (taskData) {
            loadOriginalImages();
        }
    }, [taskData, id, shareToken, t]);

    // 缁煎悎 loading 鍜?error 鐘舵€?
    const isLoading = isXmlLoading || isTaskLoading || (!!xmlString && !isInitialized);
    const finalLoadError = xmlError ? t('loadFailedHint') : loadError;

    const handleSaveChanges = () => {
        // 鎵ц鏍￠獙
        const result = validateDataIntegrity(scoreData, currentXml, translateValidationKey);

        if (!result.success) {
            // 鏈夐敊璇紝鏄剧ず閿欒寮圭獥
            setValidationResult(result);
            setIsValidationDialogOpen(true);
            return;
        }

        if (result.warnings.length > 0) {
            // 鏈夎鍛婏紝鏄剧ず璀﹀憡寮圭獥锛岃鐢ㄦ埛閫夋嫨
            setValidationResult(result);
            setIsValidationDialogOpen(true);
            return;
        }

        // 鏍￠獙閫氳繃锛屾墽琛屼繚瀛?
        performSave();
    };

    const performSave = () => {
        if (!currentXml) return;

        if (source === 'current') {
            // 浠?/review 鏉ョ殑缂栬緫 鈫?淇濆瓨涓?current_xml 鈫?鏇存柊 preview_image 鈫?璺冲洖 /review
            saveXmlMutation.mutate(
                { taskId: id, content: currentXml, fileType: 'current_xml', imageType: 'preview_image' },
                {
                    onSuccess: async () => {
                        await clearDraft();  // 淇濆瓨鎴愬姛鍚庢竻闄よ崏绋?
                        toast({
                            title: tCommon('savingSuccess'),
                            description: tCommon('scoreSaved'),
                        });
                        router.push(returnUrl || `/review/${id}`);
                    },
                    onError: (error) => {
                        console.error('淇濆瓨澶辫触:', error);
                        toast({
                            title: t('saveFailed'),
                            description: t('saveFailedDesc'),
                            variant: 'destructive',
                        });
                    }
                }
            );
        } else {
            // 浠?/results 鎴?/share 鏉ョ殑缂栬緫锛坰ource=final锛夆啋 淇濆瓨涓?final_xml 鈫?鏇存柊 final_image 鈫?璺冲埌鎸囧畾椤甸潰
            saveXmlMutation.mutate(
                { taskId: id, content: currentXml, fileType: 'final_xml', imageType: 'final_image' },
                {
                    onSuccess: async () => {
                        await clearDraft();  // 淇濆瓨鎴愬姛鍚庢竻闄よ崏绋?
                        toast({
                            title: tCommon('savingSuccess'),
                            description: tCommon('scoreSaved'),
                        });
                        router.push(returnUrl || `/results/${id}`);
                    },
                    onError: (error) => {
                        console.error('淇濆瓨澶辫触:', error);
                        toast({
                            title: t('saveFailed'),
                            description: t('saveFailedDesc'),
                            variant: 'destructive',
                        });
                    }
                }
            );
        }
    };

    const handleIgnoreWarningsAndSave = () => {
        setIsValidationDialogOpen(false);
        setValidationResult(null);
        performSave();
    };

    // 鎭㈠鑽夌
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

    // 鏀惧純鑽夌
    const handleDiscardDraft = async () => {
        await deleteDraft(id);
        setPendingDraft(null);
        toast({
            title: t('draftDiscarded'),
            description: t('draftDiscardedDesc'),
        });
    };

    const handlePreviewClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!currentXml) {
            console.error("No XML content to preview.");
            return;
        }
        setIsListenModalOpen(true);
    };

    // 鍚堝苟澹伴儴鍔熻兘
    const handleMergeParts = async () => {
        if (!currentXml) return;

        try {
            const flattenedXml = flattenAllMeasures(currentXml);
            setCurrentXml(flattenedXml);
            initializeHistory(flattenedXml); // 閲嶆柊鍒濆鍖栧巻鍙茶褰?

            // 閲嶆柊瑙ｆ瀽 XML
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
        // xmlVoice 鏄?1-based锛屾煡鎵?voice name 涓寘鍚搴旀暟瀛楃殑 voice
        const voice = stave.voices.find(v => v.name.includes(`${currentAddLocation.xmlVoice}`));
        if (!voice) return '';
        const [key, num] = voice.name.split(' ');
        return `${t(key as never)} ${num}`;
    }

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
    if (finalLoadError) {
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
                        <p className="text-gray-600 mb-2">{finalLoadError}</p>
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

            <div className="grow flex flex-col">
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
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mr-4">
                                {isAutoSaving ? (
                                    <>
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                        <span>{tCommon('saving')}</span>
                                    </>
                                ) : currentXml && (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        <span>{tCommon('saved')}</span>
                                    </>
                                )}
                            </div>
                            <TooltipProvider>
                                {topToolbarItems.map((item) => {
                                    // 鏍规嵁鎸夐挳绫诲瀷璁剧疆 onClick 鍜?disabled
                                    const isUndo = item.label === 'undo';
                                    const isRedo = item.label === 'redo';
                                    const isOriginalScore = item.label === 'originalScore';
                                    const isSaveChanges = item.label === 'saveChanges';

                                    const handleClick = isUndo ? handleUndo
                                        : isRedo ? handleRedo
                                            : isOriginalScore ? () => setIsImageViewerOpen(prev => !prev)
                                                : isSaveChanges ? handleSaveChanges
                                                    : undefined;

                                    const isDisabled = isUndo ? !canUndo : isRedo ? !canRedo : isSaveChanges ? saveXmlMutation.isPending : false;

                                    return (
                                        <Tooltip key={item.label}>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleClick}
                                                    disabled={isDisabled}
                                                >
                                                    {isSaveChanges && saveXmlMutation.isPending ? (
                                                        <Loader2 className="h-5 w-5 animate-spin" />
                                                    ) : (
                                                        <item.icon className="h-5 w-5" />
                                                    )}
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>{t(item.label as never)}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    );
                                })}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" onClick={handlePreviewClick}>
                                            <Eye className="h-5 w-5" />
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

                <main className="grow">
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
                        // 浣跨敤 spread 鎿嶄綔绗﹁嚜鍔ㄥ寘鍚?result 涓殑鎵€鏈夊瓧娈?
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
                        // 浣跨敤 spread 鎿嶄綔绗﹁嚜鍔ㄥ寘鍚?result 涓殑鎵€鏈夊瓧娈?
                        updateEntity({
                            ...editingEntity,
                            ...result,
                        } as Chord);
                    }}
                    chord={editingEntity as Chord}
                />
            )}

            {/* 鏍￠獙缁撴灉寮圭獥 */}
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
                                {/* 閿欒鍒楄〃 */}
                                {validationResult?.issues && validationResult.issues.length > 0 && (
                                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                                        <p className="font-medium text-destructive text-sm mb-2">
                                            {tAuth('validation.foundIssues', { count: validationResult.issues.length })}
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

                                {/* 璀﹀憡鍒楄〃 */}
                                {validationResult?.warnings && validationResult.warnings.length > 0 && (
                                    <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                                        <p className="font-medium text-yellow-600 text-sm mb-2">
                                            {tAuth('validation.foundWarnings', { count: validationResult.warnings.length })}
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

                                {/* 璇存槑鏂囧瓧 */}
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
                        {/* 鍙湁璀﹀憡鏃舵墠鏄剧ず"蹇界暐骞剁户缁?鎸夐挳 */}
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

            {/* 鑽夌鎭㈠寮圭獥 */}
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

    // 浠?URL 璇诲彇 source 鍙傛暟锛岄粯璁や负 'current'
    const sourceParam = searchParams.get('source');
    const source = (sourceParam === 'final' || sourceParam === 'enhanced' || sourceParam === 'current')
        ? sourceParam
        : 'current';

    // 浠?URL 璇诲彇 returnUrl 鍙傛暟锛堢敤浜庝繚瀛樺悗璺宠浆锛?
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
