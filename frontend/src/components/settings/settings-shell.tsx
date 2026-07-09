'use client';

import { useTranslations } from 'next-intl';
import { CreditCard, KeyRound, Monitor, ShieldCheck, User } from 'lucide-react';

import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { Footer } from '@/components/layout/footer';

const settingsTabs = [
  { href: '/settings/profile', label: 'tabs.profile', icon: User },
  { href: '/settings/security', label: 'tabs.security', icon: ShieldCheck },
  { href: '/settings/password', label: 'tabs.password', icon: KeyRound },
  { href: '/settings/sessions', label: 'tabs.sessions', icon: Monitor },
  { href: '/settings/billing', label: 'tabs.billing', icon: CreditCard },
] as const;

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('settings');
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="grow">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-32">
          <div className="mb-8">
            <p className="mb-3 text-sm font-medium text-gray-500">
              {t('breadcrumb.settings')} / {t('breadcrumb.account')}
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950 sm:text-5xl">
              {t('title')}
            </h1>
          </div>

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
      </main>
      <Footer />
    </div>
  );
}
