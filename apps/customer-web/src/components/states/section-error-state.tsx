'use client';

import type { ComponentType, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface SectionErrorStateProps {
  title?: string;
  description: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export function SectionErrorState({
  title,
  description,
  icon: Icon = CircleAlert,
  retryLabel,
  onRetry,
  className,
}: SectionErrorStateProps) {
  return (
    <Alert variant="destructive" className={className}>
      <Icon className="h-4 w-4" />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription className={retryLabel && onRetry ? 'space-y-3' : undefined}>
        {typeof description === 'string' ? <p>{description}</p> : description}
        {retryLabel && onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
