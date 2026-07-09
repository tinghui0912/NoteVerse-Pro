import { getTranslations } from 'next-intl/server';

import { SettingsEmptyPanel } from '@/components/settings/settings-empty-panel';

export default async function SettingsSessionsPage() {
  const t = await getTranslations('settings');

  return (
    <SettingsEmptyPanel
      title={t('sessions.heading')}
      description={t('sessions.description')}
    />
  );
}
