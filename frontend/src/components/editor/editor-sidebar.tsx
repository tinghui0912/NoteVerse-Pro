
'use client';

import { useTranslations } from 'next-intl';

import {
    Plus,
    Trash2,
    Combine,
    Hand,
    Loader2,
} from 'lucide-react';
import React, { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
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
import { type EditorMode } from '@/contexts/editor-provider';
import type { FingeringHandSize } from '@/types/api';
import { SlurSymbol, TieSymbol } from './music-symbols';
import { VoiceLayer } from './voice-layer';

// 工具按钮类型定义
type ToolItem = { icon: React.ElementType; label: string; mode?: EditorMode };

const noteTools: ToolItem[] = [
    { icon: Plus, label: 'add', mode: 'add' },
    { icon: Trash2, label: 'delete', mode: 'delete' },
];

const tieTools: ToolItem[] = [
    { icon: TieSymbol, label: 'addTie', mode: 'addTie' },
    { icon: SlurSymbol, label: 'addSlur', mode: 'addSlur' },
];

const fingeringHandSizes: FingeringHandSize[] = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];

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

export function EditorSidebar({
    editorMode,
    fingeringPending = false,
    onGenerateFingering,
    onToolSelect,
    onNormalizeVoices
}: {
    editorMode: EditorMode,
    fingeringPending?: boolean,
    onGenerateFingering?: (handSize: FingeringHandSize) => void,
    onToolSelect: (mode: EditorMode) => void,
    onNormalizeVoices?: () => void
}) {
    const t = useTranslations('editor');
    const common = useTranslations('common');
    const [fingeringDialogOpen, setFingeringDialogOpen] = useState(false);
    const [selectedHandSize, setSelectedHandSize] = useState<FingeringHandSize>('M');

    const confirmGenerateFingering = () => {
        onGenerateFingering?.(selectedHandSize);
        setFingeringDialogOpen(false);
    };

    return (
        <div className="space-y-4">
            <VoiceLayer />

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
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('assistantTools')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    <Button
                        variant="outline"
                        className="flex flex-col w-full h-20 items-center justify-center hover:bg-accent"
                        onClick={onNormalizeVoices}
                    >
                        <div className="h-6 w-6 mb-1 flex items-center justify-center"><Combine /></div>
                        <span className="text-xs text-center">{t('normalizeVoices')}</span>
                    </Button>
                    <Button
                        variant="outline"
                        className="flex flex-col w-full h-20 items-center justify-center hover:bg-accent"
                        disabled={fingeringPending || !onGenerateFingering}
                        onClick={() => setFingeringDialogOpen(true)}
                    >
                        <div className="h-6 w-6 mb-1 flex items-center justify-center">
                            {fingeringPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Hand className="h-5 w-5" />}
                        </div>
                        <span className="text-xs text-center">{t('generateFingering')}</span>
                    </Button>
                </div>
            </div>
            <Dialog open={fingeringDialogOpen} onOpenChange={setFingeringDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('generateFingering')}</DialogTitle>
                        <DialogDescription>{t('fingeringHandSizeDescription')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="text-sm font-medium text-muted-foreground">{t('fingeringHandSizeLabel')}</div>
                        <div className="grid grid-cols-4 gap-2">
                            {fingeringHandSizes.map((size) => (
                                <Button
                                    key={size}
                                    type="button"
                                    variant={selectedHandSize === size ? 'default' : 'outline'}
                                    className="h-11"
                                    onClick={() => setSelectedHandSize(size)}
                                >
                                    {size}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setFingeringDialogOpen(false)}>
                            {common('cancel')}
                        </Button>
                        <Button type="button" disabled={fingeringPending || !onGenerateFingering} onClick={confirmGenerateFingering}>
                            {fingeringPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {common('confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
};
