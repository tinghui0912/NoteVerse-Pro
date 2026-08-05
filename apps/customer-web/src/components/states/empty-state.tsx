'use client';

import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-32 flex-col items-center justify-center text-center text-muted-foreground',
        className
      )}
    >
      {Icon ? <Icon className="mb-4 h-14 w-14 text-muted-foreground" /> : null}
      <p className="text-sm">{title}</p>
      {description ? <p className="mt-2 max-w-md text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
