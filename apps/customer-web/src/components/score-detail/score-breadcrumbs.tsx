import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export function ScoreBreadcrumbs({ scoreTitle }: { scoreTitle: string }) {
  const scoreText = useTranslations('score');

  return (
    <nav
      aria-label={scoreText('breadcrumbLabel')}
      className="mb-6 overflow-hidden"
    >
      <ol className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <li className="shrink-0">
          <Link
            href="/library"
            className="transition-colors hover:text-foreground"
          >
            {scoreText('libraryBreadcrumb')}
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="h-4 w-4" />
        </li>
        <li
          aria-current="page"
          className="min-w-0 truncate font-medium text-foreground"
        >
          {scoreTitle}
        </li>
      </ol>
    </nav>
  );
}
