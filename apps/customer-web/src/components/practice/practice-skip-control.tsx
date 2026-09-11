'use client';

import { useTranslations } from 'next-intl';
import { SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PracticeSkipControlProps {
  visible: boolean;
  disabled: boolean;
  onSkip: () => void;
  className?: string;
}

export function PracticeSkipControl({
  visible,
  disabled,
  onSkip,
  className,
}: PracticeSkipControlProps) {
  const t = useTranslations('practice');

  if (!visible) {
    return null;
  }

  const handleClick = () => {
    if (disabled) {
      return;
    }
    onSkip();
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'pointer-events-auto h-11 gap-2 border-slate-200 bg-white text-slate-700 shadow-lg hover:bg-slate-50 hover:text-slate-950',
        className
      )}
    >
      <SkipForward className="h-4 w-4" aria-hidden="true" />
      {t('skip')}
    </Button>
  );
}
