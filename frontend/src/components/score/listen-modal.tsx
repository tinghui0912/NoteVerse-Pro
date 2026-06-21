'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ScorePreviewPanel } from './score-preview-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ListenModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  xmlString: string | null;
  children?: ReactNode;
}

export function ListenModal({ isOpen, onOpenChange, xmlString, children }: ListenModalProps) {
  const t = useTranslations('common');
  const tResults = useTranslations('results');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {children ? <DialogTrigger asChild><div onClick={() => onOpenChange(true)}>{children}</div></DialogTrigger> : null}
      <DialogContent className={cn('w-full rounded-2xl flex flex-col', 'max-w-lg md:max-w-4xl h-auto max-h-[90vh]')}>
        <DialogHeader className="flex flex-row justify-between items-center">
          <DialogTitle>{tResults('playScore')}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              <span className="sr-only">{t('cancel')}</span>
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1">
          <div className="sr-only"><DialogDescription>{tResults('playScore')}</DialogDescription></div>
          <ScorePreviewPanel active={isOpen} xmlString={xmlString} className="w-full" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
