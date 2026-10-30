'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { emptyPracticePreferences, resolvePracticeConfiguration, type PracticePreferenceProfile } from '@/lib/practice/configuration/preferences';
import { readPracticePreferences, writePracticePreferences } from '@/lib/practice/configuration/preference-storage';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import { unconfiguredReadiness } from '@/lib/practice/readiness/readiness-state';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import type { PracticeScope } from '@/lib/practice/kernel/scope';
import type { PracticeTempoSelection } from '@/lib/practice/kernel/tempo';

function useWorkspaceState(createEnvironment: () => PracticeEnvironment) {
  const [environment] = useState(createEnvironment);
  const [profile, setProfile] = useState<PracticePreferenceProfile>(emptyPracticePreferences);
  const [hydrated, setHydrated] = useState(false);
  const [scope, setScope] = useState<PracticeScope>({ kind: 'FULL' });
  const [tempoSelection, setTempoSelection] = useState<PracticeTempoSelection>({ mode: 'SCORE' });
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const lifetime = useRef(0);
  const releaseEnvironment = useCallback(() => {
    const retiring = ++lifetime.current;
    queueMicrotask(() => { if (retiring === lifetime.current) void environment.dispose(); });
  }, [environment]);
  useEffect(() => {
    const epoch = ++lifetime.current;
    queueMicrotask(() => {
      if (epoch !== lifetime.current) return;
      try { setProfile(readPracticePreferences(window.localStorage)); }
      catch { setProfile(emptyPracticePreferences); }
      setHydrated(true);
    });
    return releaseEnvironment;
  }, [environment, releaseEnvironment]);
  const updateProfile = useCallback((next: PracticePreferenceProfile) => {
    setProfile(next);
    try { writePracticePreferences(window.localStorage, next); } catch { /* Browser storage access can itself be denied. */ }
  }, []);
  const resolution = useMemo(() => resolvePracticeConfiguration(profile), [profile]);
  const configuration = resolution.status === 'COMPLETE' ? resolution.configuration : null;
  const resourcePlan = useMemo(() => configuration ? planPracticeResources(configuration) : null, [configuration]);
  const readiness = useSyncExternalStore(environment.subscribe, environment.snapshot, () => unconfiguredReadiness);
  const ready = hydrated && resourcePlan !== null && environment.matches(resourcePlan.qualification);
  const requalify = useCallback(async () => { if (resourcePlan) await environment.requalify(resourcePlan.qualification); }, [environment, resourcePlan]);
  return { profile, updateProfile, hydrated, configuration, resolution, resourcePlan, readiness, ready, requalify, environment,
    scope, setScope, tempoSelection, setTempoSelection, metronomeEnabled, setMetronomeEnabled };
}
const Workspace = createContext<ReturnType<typeof useWorkspaceState> | null>(null);
const browserEnvironment = () => new PracticeEnvironment();
export function PracticeWorkspaceProvider({ children, createEnvironment = browserEnvironment }: {
  children: ReactNode; createEnvironment?: () => PracticeEnvironment;
}) {
  const workspace = useWorkspaceState(createEnvironment);
  return <Workspace.Provider value={workspace}>{children}</Workspace.Provider>;
}
export function usePracticeWorkspace() {
  const workspace = useContext(Workspace);
  if (!workspace) throw new Error('PRACTICE_WORKSPACE_REQUIRED');
  return workspace;
}
