import { PublicShell } from '@/components/shell';

export default function PublicGroupLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
