'use client';

import { LoadingSpinner } from './loading-spinner';
import { cn } from '@/lib/utils';

type LoadingHeight = 'sm' | 'md' | 'lg' | 'screen';

const heightClass: Record<LoadingHeight, string> = {
  sm: 'min-h-32',
  md: 'min-h-[40vh]',
  lg: 'min-h-[50vh]',
  screen: 'min-h-[calc(100vh-4rem)]',
};

interface ResourceLoadingProps {
  label: string;
  minHeight?: LoadingHeight;
  className?: string;
}

export function ResourceLoading({ label, minHeight = 'lg', className }: ResourceLoadingProps) {
  return (
    <div className={cn('flex items-center justify-center', heightClass[minHeight], className)}>
      <div className="text-center">
        <LoadingSpinner size="lg" className="mx-auto mb-4" />
        <p className="font-medium text-gray-600">{label}</p>
      </div>
    </div>
  );
}
