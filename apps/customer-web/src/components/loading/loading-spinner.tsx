'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type LoadingSpinnerSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<LoadingSpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

interface LoadingSpinnerProps {
  size?: LoadingSpinnerSize;
  className?: string;
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  return (
    <Loader2
      aria-hidden="true"
      className={cn('animate-spin text-orange-500', sizeClass[size], className)}
    />
  );
}
