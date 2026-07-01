'use client';

import { CircleAlert } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

interface WorkspaceAccessDeniedProps {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}

export function WorkspaceAccessDenied({
  title,
  description,
  backHref,
  backLabel,
}: WorkspaceAccessDeniedProps) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center py-16">
      <div className="mx-4 w-full max-w-md text-center">
        <CircleAlert className="mx-auto mb-6 h-14 w-14 text-destructive" />
        <h2 className="mb-3 text-2xl font-bold text-gray-900">{title}</h2>
        <p className="mb-8 text-gray-600">{description}</p>
        <Button asChild className="px-8">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

