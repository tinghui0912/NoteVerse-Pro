import { Music2 } from 'lucide-react';

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
    <div className="w-full max-w-md text-center">
      <div className="mb-8 inline-flex h-20 w-20 items-center justify-center rounded-full bg-orange-500/20">
        <Music2 className="h-10 w-10 text-orange-400" />
      </div>
      <h1 className="mb-4 text-4xl font-bold sm:text-6xl">{title}</h1>
      {subtitle ? (
        <p className="mx-auto mb-12 max-w-xl text-lg text-gray-400">{subtitle}</p>
      ) : null}
      {children}
    </div>
  );
}
