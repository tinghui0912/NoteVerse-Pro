
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

// 瀛愮粍浠?
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

    // 杩炴帴鎿嶄綔 Hook
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

    // 娉ㄥ唽宸ュ叿鍒囨崲鍥炶皟 - 鍒囨崲宸ュ叿鏃舵竻绌洪€変腑鐘舵€?
    useEffect(() => {
        setOnToolChange(() => {
            clearTieSelection();
            clearSlurSelection();
            clearBeamSelection();
        });
        return () => setOnToolChange(null);
    }, [setOnToolChange, clearTieSelection, clearSlurSelection, clearBeamSelection]);

    const isInsertMode = editorMode === 'insert';

    // 鍗＄墖鐐瑰嚮澶勭悊 - 鏍规嵁缂栬緫妯″紡鎵ц涓嶅悓鎿嶄綔
    const handleCardClick = useCallback((location: import('@/types/score-types').EntityLocation, entity: ScoreEntity) => {
        switch (editorMode) {
            case 'insert':
                // 鎻掑叆妯″紡涓嶅鐞嗗崱鐗囩偣鍑?
                break;
            case 'select':
                // 閫夋嫨妯″紡锛氭墦寮€缂栬緫寮圭獥
                handleEditEntity(entity, location);
                break;
            case 'delete':
                // 鍒犻櫎妯″紡锛氳皟鐢ㄥ垹闄ゅ疄浣撻€昏緫
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
                // 鍏朵粬妯″紡榛樿鎵撳紑缂栬緫寮圭獥
                handleEditEntity(entity, location);
        }
    }, [editorMode, handleEditEntity, handleDeleteEntity, handleDeleteTie, handleDeleteSlur, handleDeleteBeam, handleAddTieSelection, handleAddSlurSelection, handleAddBeamSelection, toast, t, tCommon]);

    // 搴曢儴鎶藉眽鐘舵€?
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
                                            <h5 className="font-medium text-sm text-muted-foreground">{t(stave.name as never)}</h5>
                                            <Button variant="outline" onClick={() => handleAddVoice(measureIndex, staveIndex)} className="h-8 px-2 py-1 text-xs hover:bg-accent">
                                                <Plus className="h-3 w-3 mr-1" />
                                                {t('addVoice')}
                                            </Button>
                                        </div>
                                        {stave.voices.map((voice, voiceIndex) => {
                                            const [voiceKey, voiceNum] = voice.name.split(' ');
                                            const translatedVoiceName = `${t(voiceKey as never)} ${voiceNum}`;
                                            // 浠?voice.name锛堝 "voiceLabel 5"锛夋彁鍙?xmlVoice锛?-based锛?
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
                                                            // 浠?entity.meta 鑾峰彇 XML 鍘熷鍊?                                                            // xmlVoice 鏄?1-based锛岀洿鎺ユ潵鑷?MusicXML 鐨?voice 鍏冪礌
                                                            const xmlVoice = entity.meta?.xmlVoice ?? (voiceIndex + 1 + (staveIndex === 1 ? 4 : 0));
                                                            const xmlStaveIndex = entity.meta?.staveIndex ?? staveIndex;
                                                            const location = { measureIndex, staveIndex: xmlStaveIndex, xmlVoice, entityIndex };
                                                            // isHovered 鍒ゆ柇涔熼渶瑕佷娇鐢?xmlStaveIndex 鍜?xmlVoice锛屼笌 location 淇濇寔涓€鑷?
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

            {/* 绉诲姩绔簳閮ㄦ娊灞?*/}
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
                                line.startsWith('鈿狅笍') ? 'text-amber-600' : 'text-muted-foreground'
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
