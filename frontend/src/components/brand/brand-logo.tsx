'use client';

import type { ComponentPropsWithoutRef } from 'react';

import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { BrandMark } from './brand-mark';

type BrandLogoProps = {
  href?: ComponentPropsWithoutRef<typeof Link>['href'];
  showText?: boolean;
  textClassName?: string;
  markClassName?: string;
  className?: string;
};

export function BrandLogo({
  className,
  href = '/',
  markClassName,
  showText = true,
  textClassName,
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={cn('inline-flex min-w-0 items-center gap-2 font-semibold tracking-tight text-gray-950', className)}
    >
      <BrandMark className={markClassName} />
      {showText ? (
        <span className={cn('truncate', textClassName)}>NoteVerse Pro</span>
      ) : null}
    </Link>
  );
}
