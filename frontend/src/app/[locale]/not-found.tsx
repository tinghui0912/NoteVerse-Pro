import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SearchX } from 'lucide-react';
import { Link } from '@/i18n/routing';

export default function NotFound() {
  const t = useTranslations('common');

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="bg-gray-100 p-6 rounded-full mb-6">
        <SearchX className="w-12 h-12 text-gray-400" />
      </div>
      <h1 className="text-4xl font-bold tracking-tight text-gray-900 mb-4">
        404
      </h1>
      <h2 className="text-2xl font-semibold text-gray-700 mb-4">
        {t('pageNotFound')}
      </h2>
      <p className="text-lg text-gray-500 mb-8 max-w-md mx-auto">
        {t('pageNotFoundDesc')}
      </p>
      <Button asChild variant="default" size="lg">
        <Link href="/">{t('returnHome')}</Link>
      </Button>
    </div>
  );
}
