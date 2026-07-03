'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Footer } from '@/components/layout/footer';
import {
  READONLY_SCORE_CAPABILITIES,
  resolveScoreShellCapabilities,
  type ScoreShellCapabilities,
} from '@/lib/score-shell/capabilities';

interface ScoreShellProps {
  children: ReactNode;
  capabilities?: ScoreShellCapabilities | null;
  hero?: ReactNode;
  footer?: boolean;
  scoreId?: string;
  workspace?: 'view' | 'edit' | 'practice' | 'performance' | 'share' | 'public';
}

interface ScoreShellContextValue {
  capabilities: ScoreShellCapabilities;
  scoreId?: string;
  workspace?: ScoreShellProps['workspace'];
}

const ScoreShellContext = createContext<ScoreShellContextValue>({
  capabilities: READONLY_SCORE_CAPABILITIES,
});

export function useScoreShell(): ScoreShellContextValue {
  return useContext(ScoreShellContext);
}

export function ScoreShell({
  children,
  capabilities,
  hero,
  footer = true,
  scoreId,
  workspace,
}: ScoreShellProps) {
  const value: ScoreShellContextValue = {
    capabilities: resolveScoreShellCapabilities(capabilities),
    scoreId,
    workspace,
  };

  return (
    <ScoreShellContext.Provider value={value}>
      <div className="flex min-h-screen flex-col bg-gray-50">
        {hero}
        <main className="grow">{children}</main>
        {footer ? <Footer /> : null}
      </div>
    </ScoreShellContext.Provider>
  );
}
