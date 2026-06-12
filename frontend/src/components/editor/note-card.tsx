'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Note, Rest, Blank } from '@/types/score-types';
import { useScoreData } from '@/contexts/editor-provider';
import { cn } from '@/lib/utils';
import { useLongPress } from '@/hooks/use-long-press';
import { useEntityCard } from '@/hooks/use-entity-card';
import { AddButton, articulationIcons } from './add-button';
import { useBottomSheet } from './bottom-sheet-context';

/**
 * 音符/休止符/空白卡片组件
 */
export const NoteCard = ({ note, onClick, isHoveredInInsertMode, onInsertBefore, onInsertAfter }: { note: Note | Rest | Blank, onClick: () => void, isHoveredInInsertMode: boolean, onInsertBefore: () => void, onInsertAfter: () => void }) => {
    const t = useTranslations('editor');
    const { scoreData } = useScoreData();
    const connections = scoreData?.connections;

    // 使用公共 Hook 获取共享逻辑
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

    // 构建 Tooltip 内容
    const getTooltipContent = () => {
        const lines: string[] = [];

        // 第一行：类型 + 音高 + 时值
        if (note.type === 'note') {
            lines.push(`${getTitle()}: ${note.pitch} ${getDurationDisplay()}`);
        } else {
            lines.push(`${getTitle()} ${getDurationDisplay()}`);
        }

        // 第二行：位置信息
        const positionLine = getPositionLine();
        if (positionLine) {
            lines.push(positionLine);
        }

        // 连线详细信息
        lines.push(...getConnectionLines());

        return lines;
    };

    // 长按打开底部抽屉
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
                        className={cn("w-32 h-29.5 rounded-lg flex flex-col items-start text-left justify-between relative p-3 gap-2 transition-all duration-300 border shadow-sm",
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
