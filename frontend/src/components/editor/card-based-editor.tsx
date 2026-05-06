
'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
    Plus,
    Music,
    Disc3,
    AlignCenter,
    Eraser,
    Trash2,
    Equal as BeamIcon,
    Link as TieIcon,
    Spline as SlurIcon,
} from 'lucide-react';
import React, { useRef, useCallback, useState, createContext, useContext, useEffect } from 'react';
import type { ScoreEntity, Note, Chord, Rest, Blank, Articulation, TieConnection, SlurConnection, BeamConnection, EntityInfo } from '@/types/score-types';
import { useScoreData, useEditorState, useVoiceEditor, useEntityEditor, useXmlUpdater } from '@/contexts/editor-provider';
import { cn } from '@/lib/utils';
import { useLongPress } from '@/hooks/use-long-press';
import { useEntityCard } from '@/hooks/use-entity-card';
import { useConnectionOperations } from '@/hooks/use-connection-operations';
import { useToast } from '@/hooks/use-toast';

// 搴曢儴鎶藉眽 Context
interface BottomSheetContextValue {
    openSheet: (content: { title: string; lines: string[] }) => void;
}
const BottomSheetContext = createContext<BottomSheetContextValue | null>(null);
const useBottomSheet = () => useContext(BottomSheetContext);

// 榧犳爣鎷栨嫿婊氬姩 hook
const useDragScroll = () => {
    const ref = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const startX = useRef(0);
    const scrollLeft = useRef(0);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (!ref.current) return;
        isDragging.current = true;
        startX.current = e.pageX - ref.current.offsetLeft;
        scrollLeft.current = ref.current.scrollLeft;
        ref.current.style.cursor = 'grabbing';
    }, []);

    const onMouseUp = useCallback(() => {
        isDragging.current = false;
        if (ref.current) ref.current.style.cursor = 'grab';
    }, []);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging.current || !ref.current) return;
        e.preventDefault();
        const x = e.pageX - ref.current.offsetLeft;
        const walk = (x - startX.current) * 1.5; // 婊氬姩閫熷害绯绘暟
        ref.current.scrollLeft = scrollLeft.current - walk;
    }, []);

    const onMouseLeave = useCallback(() => {
        isDragging.current = false;
        if (ref.current) ref.current.style.cursor = 'grab';
    }, []);

    return { ref, onMouseDown, onMouseUp, onMouseMove, onMouseLeave };
};

const DragScrollContainer = ({
    children,
    className,
    onContainerMouseLeave
}: {
    children: React.ReactNode;
    className?: string;
    onContainerMouseLeave?: () => void;
}) => {
    const { ref, onMouseDown, onMouseUp, onMouseMove, onMouseLeave } = useDragScroll();
    return (
        <div
            ref={ref}
            className={cn("flex items-center gap-4 px-4 py-2 overflow-x-auto flex-1 min-w-0 hide-scrollbar cursor-grab select-none", className)}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseMove={onMouseMove}
            onMouseLeave={() => {
                onMouseLeave();
                onContainerMouseLeave?.();
            }}
        >
            {children}
        </div>
    );
};

const articulationIcons: Record<Articulation, React.ElementType> = {
    beam: BeamIcon,
    tie: TieIcon,
    slur: SlurIcon,
};

const AddButton = ({ onClick, className }: { onClick: () => void, className?: string }) => (
    <Button
        size="icon"
        className={cn("absolute z-10 h-8 w-8 rounded-full bg-primary text-primary-foreground shadow-lg top-1/2 -translate-y-1/2 transition-all duration-200", className)}
        onClick={e => {
            e.stopPropagation();
            onClick();
        }}
    >
        <Plus className="h-5 w-5" />
    </Button>
);


const NoteCard = ({ note, onClick, isHoveredInInsertMode, onInsertBefore, onInsertAfter }: { note: Note | Rest | Blank, onClick: () => void, isHoveredInInsertMode: boolean, onInsertBefore: () => void, onInsertAfter: () => void }) => {
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');
    const { scoreData } = useScoreData();
    const connections = scoreData?.connections;

    // 浣跨敤鍏叡 Hook 鑾峰彇鍏变韩閫昏緫
    const { articulations, getDurationDisplay, getPositionLine, getConnectionLines } = useEntityCard(note, connections);

    const getTitle = () => {
        switch (note.type) {
            case 'note':
                return t('cardTypeNote');
            case 'rest':
                return t('cardTypeRest');
            case 'blank':
                return t('cardTypeBlank');
        }
    }

    // 鏋勫缓 Tooltip 鍐呭
    const getTooltipContent = () => {
        const lines: string[] = [];

        // 绗竴琛岋細绫诲瀷 + 闊抽珮 + 鏃跺€?        if (note.type === 'note') {
            lines.push(`${getTitle()}: ${note.pitch} ${getDurationDisplay()}`);
        } else {
            lines.push(`${getTitle()} ${getDurationDisplay()}`);
        }

        // 绗簩琛岋細浣嶇疆淇℃伅
        const positionLine = getPositionLine();
        if (positionLine) {
            lines.push(positionLine);
        }

        // 杩炵嚎璇︾粏淇℃伅
        lines.push(...getConnectionLines());

        return lines;
    };

    // 闀挎寜鎵撳紑搴曢儴鎶藉眽
    const bottomSheet = useBottomSheet();
    const longPressHandlers = useLongPress({
        onLongPress: () => {
            const tooltipContent = getTooltipContent();
            if (bottomSheet && tooltipContent.length > 0) {
                bottomSheet.openSheet({
                    title: tooltipContent[0],
                    lines: tooltipContent.slice(1)
                });
            }
        },
        delay: 450,
        disabled: false
    });

    return (
        <div className="relative shrink-0">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        onClick={onClick}
                        {...longPressHandlers}
                        className={cn("w-32 h-[118px] rounded-lg flex flex-col items-start text-left justify-between relative p-3 gap-2 transition-all duration-300 border shadow-sm",
                            isHoveredInInsertMode ? 'border-dashed border-primary bg-primary/5' : 'bg-gray-50 text-gray-900 hover:shadow-xl hover:-translate-y-1'
                        )}
                    >
                        {articulations.length > 0 && (
                            <div className="absolute top-1 right-1 flex items-center gap-1">
                                {articulations.map((articulation) => {
                                    const ArticulationIcon = articulationIcons[articulation];
                                    return (
                                        <div key={articulation} className="bg-primary/20 text-primary p-0.5 rounded-full">
                                            <ArticulationIcon className="h-3 w-3" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="flex items-center justify-between w-full">
                            <p className="font-bold text-sm text-foreground">{getTitle()}</p>
                        </div>
                        <div className="min-h-10 flex-1">
                            {note.type === 'note' && (
                                <span className="text-xs font-semibold font-mono bg-primary text-white rounded px-1.5 py-0.5">{note.pitch}</span>
                            )}
                        </div>
                        <div className="text-xs text-foreground/80 bg-background rounded-full px-2 py-0.5 max-w-full truncate mt-auto">
                            {getDurationDisplay()}
                        </div>
                    </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                    {getTooltipContent().map((line, i) => (
                        <p key={i} className={i === 0 ? "font-semibold" : "text-sm text-muted-foreground"}>
                            {line}
                        </p>
                    ))}
                </TooltipContent>
            </Tooltip>
            {isHoveredInInsertMode && (
                <>
                    <AddButton onClick={onInsertBefore} className="-left-4" />
                    <AddButton onClick={onInsertAfter} className="-right-4" />
                </>
            )}
        </div>
    );
}


const ChordCard = ({ chord, onClick, isHoveredInInsertMode, onInsertBefore, onInsertAfter }: { chord: Chord, onClick: () => void, isHoveredInInsertMode: boolean, onInsertBefore: () => void, onInsertAfter: () => void }) => {
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');
    const { scoreData } = useScoreData();
    const connections = scoreData?.connections;

    // 浣跨敤鍏叡 Hook 鑾峰彇鍏变韩閫昏緫
    const { articulations, getDurationDisplay, getPositionLine, getConnectionLines } = useEntityCard(chord, connections);

    // 鏋勫缓 Tooltip 鍐呭
    const getTooltipContent = () => {
        const lines: string[] = [];

        // 绗竴琛岋細鍜屽鸡 + 鎵€鏈夐煶楂?+ 鏃跺€?        lines.push(`${t('cardTypeChord')}: ${chord.pitches.join(' + ')} ${getDurationDisplay()}`);

        // 绗簩琛岋細浣嶇疆淇℃伅
        const positionLine = getPositionLine();
        if (positionLine) {
            lines.push(positionLine);
        }

        // 杩炵嚎璇︾粏淇℃伅
        lines.push(...getConnectionLines());

        return lines;
    };

    // 闀挎寜鎵撳紑搴曢儴鎶藉眽
    const bottomSheet = useBottomSheet();
    const longPressHandlers = useLongPress({
        onLongPress: () => {
            const tooltipContent = getTooltipContent();
            if (bottomSheet && tooltipContent.length > 0) {
                bottomSheet.openSheet({
                    title: tooltipContent[0],
                    lines: tooltipContent.slice(1)
                });
            }
        },
        delay: 450,
        disabled: false
    });

    return (
        <div className="relative shrink-0">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        onClick={onClick}
                        {...longPressHandlers}
                        className={cn("w-32 h-[118px] rounded-lg flex flex-col items-start text-left justify-between relative p-3 gap-2 transition-all duration-300 border shadow-sm",
                            isHoveredInInsertMode ? 'border-dashed border-primary bg-primary/5' : 'bg-gray-50 text-gray-900 hover:shadow-xl hover:-translate-y-1'
                        )}
                    >
                        {articulations.length > 0 && (
                            <div className="absolute top-1 right-1 flex items-center gap-1">
                                {articulations.map((articulation) => {
                                    const ArticulationIcon = articulationIcons[articulation];
                                    return (
                                        <div key={articulation} className="bg-primary/20 text-primary p-0.5 rounded-full">
                                            <ArticulationIcon className="h-3 w-3" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="flex items-center justify-between w-full">
                            <p className="font-bold text-sm text-foreground">{t('cardTypeChord')}</p>
                        </div>
                        <div className="flex-1 min-h-10">
                            <ScrollArea className="h-[42px] -mr-2 pr-2">
                                <div className="flex flex-wrap items-start gap-1">
                                    {chord.pitches.map(pitch => (
                                        <span key={pitch} className="text-xs font-semibold font-mono bg-primary text-white rounded px-1.5 py-0.5">{pitch}</span>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                        <div className="text-xs text-foreground/80 bg-background rounded-full px-2 py-0.5 max-w-full truncate mt-auto">
                            {getDurationDisplay()}
                        </div>
                    </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                    {getTooltipContent().map((line, i) => (
                        <p key={i} className={i === 0 ? "font-semibold" : "text-sm text-muted-foreground"}>
                            {line}
                        </p>
                    ))}
                </TooltipContent>
            </Tooltip>
            {isHoveredInInsertMode && (
                <>
                    <AddButton onClick={onInsertBefore} className="-left-4" />
                    <AddButton onClick={onInsertAfter} className="-right-4" />
                </>
            )}
        </div>
    );
}


const AddNoteCard = ({ onClick }: { onClick: () => void }) => {
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');
    return (
        <Button
            variant="ghost"
            onClick={onClick}
            className="w-32 h-[118px] shrink-0 bg-gray-50 text-gray-900 rounded-lg flex flex-col items-center justify-center relative p-3 gap-2 border-dashed border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-2 shadow-sm"
        >
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Plus className="h-5 w-5" />
                <span className="text-xs font-semibold">{t('addEntity')}</span>
            </div>
        </Button>
    );
};

export function CardBasedEditor() {
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');
    const { scoreData, currentXml } = useScoreData();
    const {
        editorMode,
        hoveredCardLocation,
        handleMouseEnterCard,
        handleMouseLeaveCard,
        setOnToolChange,
    } = useEditorState();
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

    // 娉ㄥ唽宸ュ叿鍒囨崲鍥炶皟 - 鍒囨崲宸ュ叿鏃舵竻绌洪€変腑鐘舵€?    useEffect(() => {
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
                // 鎻掑叆妯″紡涓嶅鐞嗗崱鐗囩偣鍑?                break;
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

    // 搴曢儴鎶藉眽鐘舵€?    const [sheetOpen, setSheetOpen] = useState(false);
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
                                            // 浠?voice.name锛堝 "voiceLabel 5"锛夋彁鍙?xmlVoice锛?-based锛?                                            const xmlVoice = parseInt(voiceNum, 10) || (voiceIndex + 1 + (staveIndex === 1 ? 4 : 0));
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
                                                            // isHovered 鍒ゆ柇涔熼渶瑕佷娇鐢?xmlStaveIndex 鍜?xmlVoice锛屼笌 location 淇濇寔涓€鑷?                                                            const isHovered = isInsertMode && hoveredCardLocation?.measureIndex === measureIndex && hoveredCardLocation?.staveIndex === xmlStaveIndex && hoveredCardLocation?.xmlVoice === xmlVoice && hoveredCardLocation?.entityIndex === entityIndex;

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
