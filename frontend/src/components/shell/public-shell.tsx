import { ClientOnly } from '@/components/client-only';
import { PublicNav } from '@/components/navigation/public-nav';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClientOnly>
        <PublicNav />
      </ClientOnly>
      {children}
    </>
  );
}
