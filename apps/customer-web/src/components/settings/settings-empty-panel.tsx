import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export function SettingsEmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: {
    href: string;
    label: string;
  };
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-xl font-semibold text-gray-950">{title}</h2>
      <p className="max-w-2xl text-sm leading-6 text-gray-500">{description}</p>
      {action ? (
        <Button asChild className="mt-6 bg-orange-500 text-white hover:bg-orange-600">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </section>
  );
}
