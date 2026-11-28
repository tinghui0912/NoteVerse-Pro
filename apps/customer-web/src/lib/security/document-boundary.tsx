'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { requiresDocumentNavigation, type BrowserPolicy } from './route-policy';

/** A document's CSP and hardware permissions stay fixed for its lifetime. */
export function SecurityDocumentBoundary({
  policy,
  children,
}: {
  policy: BrowserPolicy;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const reload = requiresDocumentNavigation(policy, pathname);
  useEffect(() => {
    if (reload) window.location.replace(window.location.href);
  }, [reload]);
  return reload ? null : children;
}
