'use client';

import React from 'react';
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
import { type DraftEntry } from '@/lib/editor/draft-storage';
import { FileText, Clock } from 'lucide-react';
import { useTranslations, useFormatter } from 'next-intl';

interface DraftRecoveryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    draft: DraftEntry | null;
    onRecover: () => void;
    onDiscard: () => void;
}

/**
 * Draft recovery dialog component.
 */
export function DraftRecoveryDialog({
    open,
    onOpenChange,
    draft,
    onRecover,
    onDiscard
}: DraftRecoveryDialogProps) {
    const t = useTranslations('editor');
    const format = useFormatter();

    if (!draft) return null;

    const handleRecover = () => {
        onRecover();
        onOpenChange(false);
    };

    const handleDiscard = () => {
        onDiscard();
        onOpenChange(false);
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        {t('draft.title')}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-3 text-sm text-muted-foreground">
                            <p>
                                {t('draft.description')}
                            </p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                                <Clock className="h-4 w-4" />
                                <span>
                                    {t('draft.lastModified', {
                                        time: format.relativeTime(new Date(draft.savedAt), {
                                            now: new Date(),
                                        }),
                                    })}
                                </span>
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={handleDiscard}>
                        {t('draft.discard')}
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={handleRecover}>
                        {t('draft.recover')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
