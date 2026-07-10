import { WorkspaceShell } from '@/components/shell/workspace-shell';

export default function WorkspaceGroupLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
