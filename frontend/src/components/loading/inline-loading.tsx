'use client';

import type { ReactNode } from 'react';
import { LoadingSpinner } from './loading-spinner';
import { cn } from '@/lib/utils';

interface InlineLoadingProps {
  label?: ReactNode;
  className?: string;
  spinnerClassName?: string;
}

export function InlineLoading({ label, className, spinnerClassName }: InlineLoadingProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LoadingSpinner size="sm" className={cn('text-current', spinnerClassName)} />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
