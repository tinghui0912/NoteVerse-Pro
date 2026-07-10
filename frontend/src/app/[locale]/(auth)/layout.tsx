import { AuthShell } from '@/components/shell';

export default function AuthGroupLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
