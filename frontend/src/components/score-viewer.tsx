
'use client';

import { useTranslations } from 'next-intl';

import { AnimatePresence, motion } from 'framer-motion';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Maximize, Minimize } from 'lucide-react';
import React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

type ScoreViewerProps = {
    isMaximized: boolean;
    onToggleMaximize: () => void;
    connectionStatus?: 'disconnected' | 'connecting' | 'ready' | 'error';
    practiceStatus?: 'idle' | 'connecting' | 'practicing' | 'paused' | 'finished';
    sessionState?: string;
    alignment?: {
        beat_position: number;
        confidence: number;
    } | null;
};

export const ScoreViewer = ({
    isMaximized,
    onToggleMaximize,
    connectionStatus = 'disconnected',
    practiceStatus = 'idle',
    sessionState,
    alignment = null,
}: ScoreViewerProps) => {
    const isMobile = useIsMobile();
    const t = useTranslations('common');
    const tPractice = useTranslations('practice');

    if (isMobile === undefined) {
        return null;
    }

    return (
        <motion.div
            layout
            className={cn(
                "relative bg-white rounded-2xl flex items-center justify-center shadow-lg",
                isMaximized
                    ? "fixed inset-0 z-[100] rounded-none"
                    : "h-[60vh]"
            )}
            transition={{ duration: 0.3, ease: "easeInOut" }}
        >
            <div className="text-center px-6 space-y-3">
                <p className="text-muted-foreground">{tPractice('scoreDisplayArea')}</p>
                <div className="text-sm text-muted-foreground space-y-1">
                    <p>Practice status: {practiceStatus}</p>
                    <p>Connection: {connectionStatus}</p>
                    {sessionState ? <p>Session state: {sessionState}</p> : null}
                    {alignment ? (
                        <p>
                            Beat {alignment.beat_position.toFixed(2)}, confidence{' '}
                            {(alignment.confidence * 100).toFixed(0)}%
                        </p>
                    ) : null}
                </div>
            </div>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "absolute z-20 bg-black/20 hover:bg-black/40 text-white",
                                isMaximized ? "top-4 right-4" : "top-2 right-2"
                            )}
                            onClick={onToggleMaximize}
                        >
                            {isMaximized ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{isMaximized ? t('minimize') : t('maximize')}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </motion.div>
    );
};
