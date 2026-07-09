import { getTranslations } from 'next-intl/server';

import { SettingsEmptyPanel } from '@/components/settings/settings-empty-panel';

export default async function SettingsBillingPage() {
  const t = await getTranslations('settings');

  return (
    <SettingsEmptyPanel
      title={t('billing.heading')}
      description={t('billing.description')}
      action={{
        href: '/subscriptions',
        label: t('billing.viewPlans'),
      }}
    />
  );
}
