import { BrandMark } from '@/components/brand';

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
      <BrandMark className="mb-6 h-14 w-14 bg-orange-50 text-orange-600" iconClassName="h-7 w-7" />
      <h1 className="mb-3 text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">{title}</h1>
      {subtitle ? (
        <p className="mx-auto mb-8 max-w-xl text-base text-gray-600">{subtitle}</p>
      ) : null}
      {children}
    </div>
  );
}
