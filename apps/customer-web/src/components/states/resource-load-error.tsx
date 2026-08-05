'use client';

import type { ComponentType, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { ErrorState } from './error-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';

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
    <ErrorState
      icon={Icon}
      title={title}
      description={description}
      primaryAction={action}
      className={className}
    >
      {children}
    </ErrorState>
  );
}
