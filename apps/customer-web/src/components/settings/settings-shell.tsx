'use client';

import { useTranslations } from 'next-intl';
import { CreditCard, Monitor, ShieldCheck, User } from 'lucide-react';

import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page';

const settingsTabs = [
  { href: '/settings/profile', label: 'tabs.profile', icon: User },
  { href: '/settings/security', label: 'tabs.security', icon: ShieldCheck },
  { href: '/settings/sessions', label: 'tabs.sessions', icon: Monitor },
  { href: '/settings/billing', label: 'tabs.billing', icon: CreditCard },
] as const;

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('settings');
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${t('breadcrumb.settings')} / ${t('breadcrumb.account')}`}
        title={t('title')}
      />

      <div className="mb-5 overflow-x-auto border-b border-gray-200">
        <nav className="flex min-w-max gap-8" aria-label={t('tabsLabel')}>
          {settingsTabs.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-1 pb-4 text-sm font-semibold transition-colors',
                  isActive
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                )}
              >
                <Icon className="h-4 w-4" />
                {t(item.label)}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
