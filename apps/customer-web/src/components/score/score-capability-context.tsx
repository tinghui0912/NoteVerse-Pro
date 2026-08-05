'use client';

import { createContext, useContext, type ReactNode } from 'react';

import {
  READONLY_SCORE_CAPABILITIES,
  resolveScoreCapabilities,
  type ScoreCapabilitySet,
} from '@/lib/score/capabilities';

type ScoreWorkspace = 'view' | 'edit' | 'practice' | 'performance' | 'share' | 'public';

interface ScoreCapabilityContextValue {
  capabilities: ScoreCapabilitySet;
  scoreId?: string;
  workspace?: ScoreWorkspace;
}

const ScoreCapabilityContext = createContext<ScoreCapabilityContextValue>({
  capabilities: READONLY_SCORE_CAPABILITIES,
});

export function useScoreCapabilities(): ScoreCapabilityContextValue {
  return useContext(ScoreCapabilityContext);
}

export function ScoreCapabilityProvider({
  children,
  capabilities,
  scoreId,
  workspace,
}: {
  children: ReactNode;
  capabilities?: ScoreCapabilitySet | null;
  scoreId?: string;
  workspace?: ScoreWorkspace;
}) {
  const value: ScoreCapabilityContextValue = {
    capabilities: resolveScoreCapabilities(capabilities),
    scoreId,
    workspace,
  };

  return (
    <ScoreCapabilityContext.Provider value={value}>
      {children}
    </ScoreCapabilityContext.Provider>
  );
}

export type { ScoreCapabilityContextValue, ScoreWorkspace };
