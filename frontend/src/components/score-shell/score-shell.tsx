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
  embedded?: boolean;
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
  embedded = false,
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
      <div className={embedded ? 'bg-gray-50' : 'flex min-h-screen flex-col bg-gray-50'}>
        {hero}
        {embedded ? children : <main className="grow">{children}</main>}
        {!embedded && footer ? <Footer /> : null}
      </div>
    </ScoreShellContext.Provider>
  );
}
