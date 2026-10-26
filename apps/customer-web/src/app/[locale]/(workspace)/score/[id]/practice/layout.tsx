import type { ReactNode } from 'react';
import { PracticeWorkspaceProvider } from '@/contexts/practice-workspace-context';

export default function PracticeLayout({ children }: { children: ReactNode }) {
  return <PracticeWorkspaceProvider>{children}</PracticeWorkspaceProvider>;
}
