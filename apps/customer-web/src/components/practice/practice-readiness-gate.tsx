'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
import { practiceLocation } from '@/lib/practice/configuration/practice-location';

export function PracticeReadinessGate({ children }: { children: ReactNode }) {
  const workspace = usePracticeWorkspace();
  const params = useParams<{ id: string }>(), query = useSearchParams(), router = useRouter();
  const t = useTranslations('practice');
  const [admitted, setAdmitted] = useState(false);
  if (workspace.ready && !admitted) setAdmitted(true);
  useEffect(() => {
    if (workspace.hydrated && !workspace.ready && !admitted) router.replace(practiceLocation(params.id, 'setup', query.get('practiceRevisionId')));
  }, [workspace.hydrated, workspace.ready, admitted, router, params.id, query]);
  return workspace.ready || admitted ? children : <p className="p-6" role="status">{t('setupRequired')}</p>;
}
