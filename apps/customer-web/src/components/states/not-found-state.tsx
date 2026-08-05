'use client';

import type { ReactNode } from 'react';
import { SearchX } from 'lucide-react';
import { ErrorState } from './error-state';

interface NotFoundStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function NotFoundState({ title, description, action, className }: NotFoundStateProps) {
  return (
    <ErrorState
      icon={SearchX}
      title={title}
      description={description}
      primaryAction={action}
      className={className}
    />
  );
}
