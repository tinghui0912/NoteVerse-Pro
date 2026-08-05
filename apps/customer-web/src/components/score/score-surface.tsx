import type { ReactNode } from 'react';

export function ScoreSurface({ children }: { children: ReactNode }) {
  return <div className="bg-gray-50">{children}</div>;
}
