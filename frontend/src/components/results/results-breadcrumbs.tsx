import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { ResultsHistorySource } from '@/lib/results/navigation';

export function ResultsBreadcrumbs({
  scoreTitle,
  source,
}: {
  scoreTitle: string;
  source: ResultsHistorySource | null;
}) {
  const history = useTranslations('history');
  const results = useTranslations('results');
  const sourceLabel = source === 'shares' ? history('savedShares') : history('myUploads');

  return (
    <nav aria-label={results('breadcrumbLabel')} className="mb-6 overflow-hidden">
      <ol className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <li className="shrink-0">
          <Link href="/history" className="transition-colors hover:text-foreground">
            {results('historyBreadcrumb')}
          </Link>
        </li>
        {source ? (
          <>
            <li aria-hidden="true"><ChevronRight className="h-4 w-4" /></li>
            <li className="shrink-0">
              <Link
                href={`/history?tab=${source}`}
                className="transition-colors hover:text-foreground"
              >
                {sourceLabel}
              </Link>
            </li>
          </>
        ) : null}
        <li aria-hidden="true"><ChevronRight className="h-4 w-4" /></li>
        <li aria-current="page" className="min-w-0 truncate font-medium text-foreground">
          {scoreTitle}
        </li>
      </ol>
    </nav>
  );
}
