import { redirect } from '@/i18n/routing';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  redirect({ href: '/settings/profile', locale });
}
