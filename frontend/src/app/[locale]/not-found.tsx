import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { NotFoundState } from '@/components/states';
import { Link } from '@/i18n/routing';

export default function NotFound() {
  const t = useTranslations('common');

  return (
    <NotFoundState
      title={t('pageNotFound')}
      description={t('pageNotFoundDesc')}
      className="min-h-[70vh] px-4"
      action={
        <Button asChild size="lg">
          <Link href="/">{t('returnHome')}</Link>
        </Button>
      }
    />
  );
}
