'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Note, Rest, Blank } from '@/types/score-types';
import { useScoreData } from '@/contexts/editor-provider';
import { cn } from '@/lib/utils';
import { useEntityCard } from '@/hooks/editor/use-entity-card';
import { articulationIcons } from './articulation-icons';

export const NoteCard = ({ note, onClick }: { note: Note | Rest | Blank, onClick: () => void }) => {
    const t = useTranslations('editor');
    const { scoreData } = useScoreData();
    const connections = scoreData?.connections;
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
    };

    const getTooltipContent = () => {
        const lines: string[] = [];

        if (note.type === 'note') {
            lines.push(`${getTitle()}: ${note.pitch} ${getDurationDisplay()}`);
        } else {
            lines.push(`${getTitle()} ${getDurationDisplay()}`);
        }

        const positionLine = getPositionLine();
        if (positionLine) lines.push(positionLine);
        lines.push(...getConnectionLines());

        return lines;
    };

    return (
        <div className="relative shrink-0">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        onClick={onClick}
                        className={cn(
                            'w-32 h-29.5 rounded-lg flex flex-col items-start text-left justify-between relative p-3 gap-2 transition-all duration-300 border shadow-sm',
                            'bg-gray-50 text-gray-900 hover:shadow-xl hover:-translate-y-1'
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
                        <p key={i} className={i === 0 ? 'font-semibold' : 'text-sm text-muted-foreground'}>
                            {line}
                        </p>
                    ))}
                </TooltipContent>
            </Tooltip>
        </div>
    );
};