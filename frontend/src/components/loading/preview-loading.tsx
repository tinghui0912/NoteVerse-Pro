'use client';

import { LoadingSpinner } from './loading-spinner';
import { cn } from '@/lib/utils';

interface PreviewLoadingProps {
  label?: string;
  className?: string;
}

export function PreviewLoading({ label, className }: PreviewLoadingProps) {
  return (
    <div
      className={cn(
        'flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground',
        className
      )}
    >
      <LoadingSpinner size="lg" className="text-current" />
      {label ? <p>{label}</p> : null}
    </div>
  );
}
