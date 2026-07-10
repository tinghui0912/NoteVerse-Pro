'use client';

import type { ComponentType, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';

interface ResourceLoadErrorProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
  children?: ReactNode;
}

export function ResourceLoadError({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  icon: Icon = CircleAlert,
  className,
  children,
}: ResourceLoadErrorProps) {
  const action = actionLabel
    ? actionHref
      ? (
        <Button asChild className="px-8">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )
      : (
        <Button onClick={onAction} className="px-8">
          {actionLabel}
        </Button>
      )
    : null;

  return (
    <div className={cn('flex min-h-[50vh] items-center justify-center py-16', className)}>
      <div className="mx-4 w-full max-w-md text-center">
        <Icon className="mx-auto mb-6 h-14 w-14 text-destructive" />
        <h2 className="mb-3 text-2xl font-bold text-gray-900">{title}</h2>
        <p className="mb-8 text-gray-600">{description}</p>
        {children}
        {action}
      </div>
    </div>
  );
}
