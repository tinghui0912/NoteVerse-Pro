import type { ReactNode } from 'react';
import { Footer } from '@/components/layout/footer';

interface ScoreShellProps {
  children: ReactNode;
  hero?: ReactNode;
  footer?: boolean;
}

export function ScoreShell({ children, hero, footer = true }: ScoreShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {hero}
      <main className="grow">{children}</main>
      {footer ? <Footer /> : null}
    </div>
  );
}
