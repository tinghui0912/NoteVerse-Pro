import { AuthShell } from '@/components/shell/auth-shell';

export default function AuthGroupLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
