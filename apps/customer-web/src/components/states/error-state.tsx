'use client';

import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function ErrorState({
  title,
  description,
  icon: Icon = AlertTriangle,
  primaryAction,
  secondaryAction,
  className,
  children,
}: ErrorStateProps) {
  return (
    <div className={cn('flex min-h-[50vh] items-center justify-center py-16', className)}>
      <div className="mx-4 w-full max-w-md text-center">
        <Icon className="mx-auto mb-6 h-14 w-14 text-destructive" />
        <h2 className="mb-3 text-2xl font-bold text-gray-950">{title}</h2>
        {description ? <p className="mb-8 text-gray-600">{description}</p> : null}
        {children}
        {primaryAction || secondaryAction ? (
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            {primaryAction}
            {secondaryAction}
          </div>
        ) : null}
      </div>
    </div>
  );
}
