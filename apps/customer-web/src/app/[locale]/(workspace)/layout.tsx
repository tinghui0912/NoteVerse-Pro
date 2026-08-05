import { WorkspaceShell } from '@/components/shell';

export default function WorkspaceGroupLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
