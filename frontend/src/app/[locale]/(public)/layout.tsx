import { PublicShell } from '@/components/shell/public-shell';

export default function PublicGroupLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
