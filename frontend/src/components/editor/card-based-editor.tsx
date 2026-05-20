
'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
    Plus,
    Eraser,
    Trash2,
} from 'lucide-react';
import React, { useCallback, useState, useEffect } from 'react';
import type { ScoreEntity } from '@/types/score-types';
import { useScoreData, useEditorState, useVoiceEditor, useEntityEditor, useXmlUpdater, useHoverState } from '@/contexts/editor-provider';
import { cn } from '@/lib/utils';
import { useConnectionOperations } from '@/hooks/use-connection-operations';
import { useToast } from '@/hooks/use-toast';

// 子组件
import { BottomSheetContext } from './bottom-sheet-context';
import { DragScrollContainer } from './drag-scroll-container';
import { NoteCard } from './note-card';
import { ChordCard } from './chord-card';
import { AddNoteCard } from './add-note-card';

export function CardBasedEditor() {
    const t = useTranslations('editor');
    const tCommon = useTranslations('common');
    const { scoreData, currentXml } = useScoreData();
    const {
        editorMode,
        setOnToolChange,
    } = useEditorState();
    const {
        hoveredCardLocation,
        handleMouseEnterCard,
        handleMouseLeaveCard,
    } = useHoverState();
    const { handleAddEntity, handleEditEntity, handleDeleteEntity } = useEntityEditor();
    const {
        handleAddVoice,
        handleClearVoice,
        handleDeleteVoice,
    } = useVoiceEditor();
    const { updateMusicXML } = useXmlUpdater();
    const { toast } = useToast();

    // 连接操作 Hook
    const {
        handleDeleteTie,
        handleDeleteSlur,
        handleDeleteBeam,
        handleAddTieSelection,
        handleAddSlurSelection,
        handleAddBeamSelection,
        clearTieSelection,
        clearSlurSelection,
        clearBeamSelection,
    } = useConnectionOperations({ scoreData, currentXml, updateMusicXML });

    // 注册工具切换回调 - 切换工具时清空选中状态
    useEffect(() => {
        setOnToolChange(() => {
            clearTieSelection();
            clearSlurSelection();
            clearBeamSelection();
        });
        return () => setOnToolChange(null);
    }, [setOnToolChange, clearTieSelection, clearSlurSelection, clearBeamSelection]);

    const isInsertMode = editorMode === 'insert';

    // 卡片点击处理 - 根据编辑模式执行不同操作
    const handleCardClick = useCallback((location: import('@/types/score-types').EntityLocation, entity: ScoreEntity) => {
        switch (editorMode) {
            case 'insert':
                // 插入模式不处理卡片点击
                break;
            case 'select':
                // 选择模式：打开编辑弹窗
                handleEditEntity(entity, location);
                break;
            case 'delete':
                // 删除模式：调用删除实体逻辑
                handleDeleteEntity(location);
                toast({ title: tCommon('operationSuccess'), description: t('noteDeleted') });
                break;
            case 'addTie': {
                const result = handleAddTieSelection(location, entity);
                if (!result.success) {
                    toast({ title: tCommon('operationFailed'), description: result.message, variant: 'destructive' });
                } else {
                    toast({ title: tCommon('operationSuccess'), description: result.message });
                }
                break;
            }
            case 'deleteTie': {
                const result = handleDeleteTie(entity);
                if (!result.success) {
                    toast({ title: tCommon('operationFailed'), description: result.message, variant: 'destructive' });
                } else {
                    toast({ title: tCommon('operationSuccess'), description: result.message });
                }
                break;
            }
            case 'addSlur': {
                const result = handleAddSlurSelection(location, entity);
                if (!result.success) {
                    toast({ title: tCommon('operationFailed'), description: result.message, variant: 'destructive' });
                } else {
                    toast({ title: tCommon('operationSuccess'), description: result.message });
                }
                break;
            }
            case 'deleteSlur': {
                const result = handleDeleteSlur(entity);
                if (!result.success) {
                    toast({ title: tCommon('operationFailed'), description: result.message, variant: 'destructive' });
                } else {
                    toast({ title: tCommon('operationSuccess'), description: result.message });
                }
                break;
            }
            case 'addBeam': {
                const result = handleAddBeamSelection(location, entity);
                if (!result.success) {
                    toast({ title: tCommon('operationFailed'), description: result.message, variant: 'destructive' });
                } else {
                    toast({ title: tCommon('operationSuccess'), description: result.message });
                }
                break;
            }
            case 'deleteBeam': {
                const result = handleDeleteBeam(entity);
                if (!result.success) {
                    toast({ title: tCommon('operationFailed'), description: result.message, variant: 'destructive' });
                } else {
                    toast({ title: tCommon('operationSuccess'), description: result.message });
                }
                break;
            }
            default:
                // 其他模式默认打开编辑弹窗
                handleEditEntity(entity, location);
        }
    }, [editorMode, handleEditEntity, handleDeleteEntity, handleDeleteTie, handleDeleteSlur, handleDeleteBeam, handleAddTieSelection, handleAddSlurSelection, handleAddBeamSelection, toast, t, tCommon]);

    // 底部抽屉状态
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetContent, setSheetContent] = useState<{ title: string; lines: string[] }>({ title: '', lines: [] });

    const openSheet = useCallback((content: { title: string; lines: string[] }) => {
        setSheetContent(content);
        setSheetOpen(true);
    }, []);

    if (!scoreData) {
        return (
            <Card className="bg-white rounded-2xl shadow-lg p-8 text-center">
                <p className="text-muted-foreground">{tCommon('loadingScoreData')}</p>
            </Card>
        );
    }

    return (
        <BottomSheetContext.Provider value={{ openSheet }}>
            <TooltipProvider>
                <div className="space-y-4">
                    {scoreData.measures.map((measure, measureIndex) => (
                        <Card key={measure.number} className="bg-white rounded-2xl shadow-lg">
                            <div className="p-4 space-y-4">
                                <CardTitle className="font-semibold text-foreground text-base">{t('measureLabel')} {measure.number}</CardTitle>
                                {measure.staves.map((stave, staveIndex) => (
                                    <div key={staveIndex} className="space-y-3">
                                        <div className="flex justify-between items-center mb-2">
                                            <h5 className="font-medium text-sm text-muted-foreground">{t(stave.name as any)}</h5>
                                            <Button variant="outline" onClick={() => handleAddVoice(measureIndex, staveIndex)} className="h-8 px-2 py-1 text-xs hover:bg-accent">
                                                <Plus className="h-3 w-3 mr-1" />
                                                {t('addVoice')}
                                            </Button>
                                        </div>
                                        {stave.voices.map((voice, voiceIndex) => {
                                            const [voiceKey, voiceNum] = voice.name.split(' ');
                                            const translatedVoiceName = `${t(voiceKey as any)} ${voiceNum}`;
                                            // 从 voice.name（如 "voiceLabel 5"）提取 xmlVoice（1-based）
                                            const xmlVoice = parseInt(voiceNum, 10) || (voiceIndex + 1 + (staveIndex === 1 ? 4 : 0));
                                            return (
                                                <div key={voiceIndex} className="flex items-center gap-4">
                                                    <div className="w-28 shrink-0 flex items-center gap-2">
                                                        <p className="font-semibold text-sm truncate">{translatedVoiceName}</p>
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    {voice.notes.length > 0 ? (
                                                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleClearVoice(measureIndex, staveIndex, xmlVoice)}>
                                                                            <Eraser className="h-4 w-4" />
                                                                        </Button>
                                                                    ) : (
                                                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteVoice(measureIndex, staveIndex, xmlVoice, voiceIndex)}>
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    )}
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>{t(voice.notes.length > 0 ? 'clearVoice' : 'deleteVoice')}</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                    <DragScrollContainer onContainerMouseLeave={handleMouseLeaveCard}>
                                                        {voice.notes.map((entity, entityIndex) => {
                                                            // 从 entity.meta 获取 XML 原始值
                                                            // xmlVoice 是 1-based，直接来自 MusicXML 的 voice 元素
                                                            const xmlVoice = entity.meta?.xmlVoice ?? (voiceIndex + 1 + (staveIndex === 1 ? 4 : 0));
                                                            const xmlStaveIndex = entity.meta?.staveIndex ?? staveIndex;
                                                            const location = { measureIndex, staveIndex: xmlStaveIndex, xmlVoice, entityIndex };
                                                            // isHovered 判断也需要使用 xmlStaveIndex 和 xmlVoice，与 location 保持一致
                                                            const isHovered = isInsertMode && hoveredCardLocation?.measureIndex === measureIndex && hoveredCardLocation?.staveIndex === xmlStaveIndex && hoveredCardLocation?.xmlVoice === xmlVoice && hoveredCardLocation?.entityIndex === entityIndex;

                                                            const cardProps = {
                                                                onClick: () => handleCardClick(location, entity),
                                                                isHoveredInInsertMode: isHovered,
                                                                onInsertBefore: () => handleAddEntity({ ...location, position: 'before' as const }),
                                                                onInsertAfter: () => handleAddEntity({ ...location, position: 'after' as const }),
                                                            }

                                                            return (
                                                                <div key={entityIndex} onMouseEnter={() => handleMouseEnterCard(location)} className="shrink-0">
                                                                    {(entity.type === 'note' || entity.type === 'rest' || entity.type === 'blank') && <NoteCard note={entity} {...cardProps} />}
                                                                    {entity.type === 'chord' && <ChordCard chord={entity} {...cardProps} />}
                                                                </div>
                                                            )
                                                        })}
                                                        {voice.notes.length === 0 && (
                                                            <AddNoteCard onClick={() => handleAddEntity({ measureIndex, staveIndex, xmlVoice: voiceIndex + 1 + (staveIndex === 1 ? 4 : 0), entityIndex: 0, position: 'before' })} />
                                                        )}
                                                    </DragScrollContainer>
                                                </div>
                                            )
                                        })}
                                    </div>
                                ))}
                            </div>
                        </Card>
                    ))}
                </div>
            </TooltipProvider>

            {/* 移动端底部抽屉 */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl">
                    <SheetHeader className="text-left">
                        <SheetTitle className="text-base font-semibold">{sheetContent.title}</SheetTitle>
                        <SheetDescription className="sr-only">{tCommon('noteDetailDescription')}</SheetDescription>
                    </SheetHeader>
                    <div className="mt-4 space-y-2 text-left">
                        {sheetContent.lines.map((line, i) => (
                            <p key={i} className={cn(
                                "text-sm",
                                line.startsWith('⚠️') ? 'text-amber-600' : 'text-muted-foreground'
                            )}>
                                {line}
                            </p>
                        ))}
                    </div>
                </SheetContent>
            </Sheet>
        </BottomSheetContext.Provider>
    );
}
