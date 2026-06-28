
'use client';

import { useTranslations } from 'next-intl';

import {
    Plus,
    Trash2,
    Combine,
    XCircle,
} from 'lucide-react';
import React, { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useScoreData, type EditorMode } from '@/contexts/editor-provider';
import { BeamSymbol, SlurSymbol, TieSymbol } from './music-symbols';

// 工具按钮类型定义
type ToolItem = { icon: React.ElementType; label: string; mode?: EditorMode };

const noteTools: ToolItem[] = [
    { icon: Plus, label: 'add', mode: 'insert' },
    { icon: Trash2, label: 'delete', mode: 'delete' },
];


const DeleteConnectionIcon = ({ icon: Icon }: { icon: React.ElementType }) => (
    <div className="relative">
        <Icon className="h-6 w-6" />
        <XCircle className="absolute -right-2 -top-1 h-4 w-4 rounded-full bg-destructive-foreground text-destructive" />
    </div>
);
const tieTools: ToolItem[] = [
    { icon: BeamSymbol, label: 'addBeam', mode: 'addBeam' },
    { icon: () => <DeleteConnectionIcon icon={BeamSymbol} />, label: 'deleteBeam', mode: 'deleteBeam' },
    { icon: TieSymbol, label: 'addTie', mode: 'addTie' },
    { icon: () => <DeleteConnectionIcon icon={TieSymbol} />, label: 'deleteTie', mode: 'deleteTie' },
    { icon: SlurSymbol, label: 'addSlur', mode: 'addSlur' },
    { icon: () => <DeleteConnectionIcon icon={SlurSymbol} />, label: 'deleteSlur', mode: 'deleteSlur' },
];

const ToolButton = ({ tool, isActive, onToolSelect }: { tool: ToolItem, isActive: boolean, onToolSelect: (mode: EditorMode) => void }) => {
    const isMobile = useIsMobile();
    const isClient = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );
    const t = useTranslations('editor');

    if (!isClient) {
        return <Skeleton className="h-20 w-full" />;
    }

    const translatedLabel = t(tool.label as never);

    const handleClick = () => {
        if (tool.mode) {
            onToolSelect(tool.mode);
        }
    };

    const button = (
        <Button
            variant="outline"
            className={cn(
                "flex flex-col w-full h-20 items-center justify-center hover:bg-accent",
                isActive && "bg-accent text-accent-foreground"
            )}
            onClick={handleClick}
        >
            <div className="h-6 w-6 mb-1 flex items-center justify-center"><tool.icon /></div>
            <span className="text-xs text-center">{translatedLabel}</span>
        </Button>
    );

    return isMobile ? (
        button
    ) : (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    {button}
                </TooltipTrigger>
                <TooltipContent><p>{translatedLabel}</p></TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export function EditorSidebar({ editorMode, onToolSelect, onMergeParts }: { editorMode: EditorMode, onToolSelect: (mode: EditorMode) => void, onMergeParts?: () => void }) {
    const t = useTranslations('editor');
    const { scoreData } = useScoreData();

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('statistics')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-background/50 border flex flex-col items-center justify-center h-20">
                        <span className="text-2xl font-bold font-mono">{scoreData?.measureCount ?? 0}</span>
                        <span className="text-xs text-muted-foreground">{t('measureCount')}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-background/50 border flex flex-col items-center justify-center h-20">
                        <span className="text-2xl font-bold font-mono">{scoreData?.noteCount ?? 0}</span>
                        <span className="text-xs text-muted-foreground">{t('noteCount')}</span>
                    </div>
                </div>
            </div>

            <Separator />

            <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('noteTools')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    {noteTools.map(tool => (
                        <ToolButton
                            key={tool.label}
                            tool={tool}
                            isActive={!!tool.mode && tool.mode === editorMode}
                            onToolSelect={onToolSelect}
                        />
                    ))}
                </div>
            </div>

            <Separator />

            <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('tieTools')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    {tieTools.map(tool => (
                        <ToolButton key={tool.label} tool={tool} isActive={!!tool.mode && tool.mode === editorMode} onToolSelect={onToolSelect} />
                    ))}
                </div>
            </div>

            <Separator />

            <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('correctionTools')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    <Button
                        variant="outline"
                        className="flex flex-col w-full h-20 items-center justify-center hover:bg-accent"
                        onClick={onMergeParts}
                    >
                        <div className="h-6 w-6 mb-1 flex items-center justify-center"><Combine /></div>
                        <span className="text-xs text-center">{t('mergeParts')}</span>
                    </Button>
                </div>
            </div>
        </div>
    )
};
