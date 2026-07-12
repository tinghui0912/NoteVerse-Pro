'use client';

import { Music2 } from 'lucide-react';

import { cn } from '@/lib/utils';

type BrandMarkProps = {
  className?: string;
  iconClassName?: string;
};

export function BrandMark({ className, iconClassName }: BrandMarkProps) {
  return (
    <span
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-500 text-white',
        className
      )}
      aria-hidden="true"
    >
      <Music2 className={cn('h-5 w-5', iconClassName)} />
    </span>
  );
}
