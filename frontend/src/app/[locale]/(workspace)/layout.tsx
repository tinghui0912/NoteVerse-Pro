import { WorkspaceShell } from '@/components/workspace-shell/workspace-shell';

export default function WorkspaceGroupLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
