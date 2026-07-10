'use client';

import { LoadingSpinner } from './loading-spinner';
import { cn } from '@/lib/utils';

interface SectionLoadingProps {
  label: string;
  className?: string;
}

export function SectionLoading({ label, className }: SectionLoadingProps) {
  return (
    <div className={cn('flex min-h-32 items-center justify-center text-sm text-gray-500', className)}>
      <LoadingSpinner size="sm" className="mr-2" />
      {label}
    </div>
  );
}
