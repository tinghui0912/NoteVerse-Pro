import { getTranslations } from 'next-intl/server';

import { SettingsEmptyPanel } from '@/components/settings/settings-empty-panel';

export default async function SettingsSecurityPage() {
  const t = await getTranslations('settings');

  return (
    <SettingsEmptyPanel
      title={t('security.heading')}
      description={t('security.description')}
    />
  );
}
