
'use client';

import { useTranslations } from 'next-intl';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X, Music, Disc3, AlignCenter, Eraser } from 'lucide-react';
import type { ScoreEntityType } from '@/types/score-types';
import { cn } from '@/lib/utils';

interface AddEntityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: ScoreEntityType) => void;
  voiceName: string;
}

export function AddEntityModal({
  isOpen,
  onClose,
  onSelect,
  voiceName,
}: AddEntityModalProps) {
  const t = useTranslations('editor');

  const entityTypes: {
    type: ScoreEntityType;
    label: string;
    icon: React.ElementType;
  }[] = [
      { type: 'note', label: 'cardTypeNote', icon: Music },
      { type: 'chord', label: 'cardTypeChord', icon: Disc3 },
      { type: 'rest', label: 'cardTypeRest', icon: AlignCenter },
      { type: 'blank', label: 'cardTypeBlank', icon: Eraser },
    ];

  const handleSelect = (type: ScoreEntityType) => {
    onSelect(type);
  };

  const isBlankDisabled = voiceName.includes(t('voiceLabel') + ' 1') || voiceName.includes(t('voiceLabel') + ' 5');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addEntity')}</DialogTitle>
          <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          {entityTypes.map(({ type, label, icon: Icon }) => {
            const isDisabled = type === 'blank' && isBlankDisabled;
            return (
              <Button
                key={type}
                variant="outline"
                className="h-24 flex-col gap-2"
                onClick={() => handleSelect(type)}
                disabled={isDisabled}
              >
                <Icon className={cn('h-6 w-6', isDisabled ? 'text-muted-foreground' : 'text-primary')} />
                <span>{t(label as never)}</span>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
