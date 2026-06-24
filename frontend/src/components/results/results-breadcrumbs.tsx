import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { ResultsLibrarySource } from '@/lib/results/navigation';

export function ResultsBreadcrumbs({
  scoreTitle,
  source,
}: {
  scoreTitle: string;
  source: ResultsLibrarySource | null;
}) {
  const library = useTranslations('library');
  const common = useTranslations('common');
  const results = useTranslations('results');
  const sourceLabel = source === 'shares' ? library('favorites') : common('nav.myScores');
  const rootLabel = source === 'my-scores' ? common('nav.myScores') : results('libraryBreadcrumb');
  const rootHref = source === 'my-scores' ? '/my-scores' : '/library';

  return (
    <nav aria-label={results('breadcrumbLabel')} className="mb-6 overflow-hidden">
      <ol className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <li className="shrink-0">
          <Link href={rootHref} className="transition-colors hover:text-foreground">
            {rootLabel}
          </Link>
        </li>
        {source === 'shares' ? (
          <>
            <li aria-hidden="true"><ChevronRight className="h-4 w-4" /></li>
            <li className="shrink-0">
              <Link
                href="/library?view=favorites"
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
