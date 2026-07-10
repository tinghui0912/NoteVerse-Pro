import PillNav from '@/components/layout/pill-nav';
import { ClientOnly } from '@/components/client-only';

export default function PublicGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClientOnly>
        <PillNav />
      </ClientOnly>
      {children}
    </>
  );
}
