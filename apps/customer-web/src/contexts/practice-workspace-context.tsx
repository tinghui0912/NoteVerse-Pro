'use client';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyPracticePreferences, resolvePracticeConfiguration, type PracticePreferenceProfile } from '@/lib/practice/configuration/preferences';
import { readPracticePreferences, writePracticePreferences } from '@/lib/practice/configuration/preference-storage';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import { matchesPreparationConfiguration, type PreparedPractice } from '@/lib/practice/preparation/prepared-practice';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { releaseTransientReviewSession, createTransientReviewSession, type TransientReviewSession } from '@/lib/practice/review/transient-review-session';
import type { ContinuousPracticeCompletion } from '@/lib/practice/continuous/completion';
import type { PracticeScope } from '@/lib/practice/planning/scope';
import type { PracticeTempoSelection } from '@/lib/practice/planning/tempo';

function useWorkspaceState(createEnvironment: () => PracticeEnvironment) {
  const pathname = usePathname();
  const [environment] = useState(createEnvironment);
  const [profile, setProfile] = useState<PracticePreferenceProfile>(emptyPracticePreferences);
  const [hydrated, setHydrated] = useState(false);
  const [scope, setScope] = useState<PracticeScope>({ kind: 'FULL' });
  const [tempoSelection, setTempoSelection] = useState<PracticeTempoSelection>({ mode: 'SCORE' });
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [preparedPractice, setPreparedPractice] = useState<PreparedPractice | null>(null);
  const [reviewSession, setReviewSession] = useState<TransientReviewSession | null>(null);
  const review = useRef<TransientReviewSession | null>(null);
  const clearReviewSession = useCallback(() => {
    const previous = review.current; review.current = null; setReviewSession(null);
    return releaseTransientReviewSession(previous);
  }, []);
  const prepared = useRef<PreparedPractice | null>(null);
  const preparation = useRef<AbortController | null>(null);
  const configurationRef = useRef<ReturnType<typeof resolvePracticeConfiguration>>(resolvePracticeConfiguration(profile));
  const clearPreparedPractice = useCallback(() => {
    preparation.current?.abort(); preparation.current = null;
    prepared.current?.binding.close(); prepared.current = null;
    setPreparedPractice(null);
  }, []);
  useEffect(() => {
    // Route entry invalidates handoffs; a handoff created before navigation survives
    // rerenders on the unchanged Practice route.
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      if (!pathname?.endsWith('/review')) clearReviewSession();
      if (!pathname?.endsWith('/practice')) clearPreparedPractice();
    });
    return () => { current = false; };
  }, [pathname, clearPreparedPractice, clearReviewSession]);
  const beginPreparation = useCallback(() => {
    clearReviewSession();
    clearPreparedPractice();
    const transaction = new AbortController(); preparation.current = transaction;
    return transaction;
  }, [clearPreparedPractice, clearReviewSession]);
  const commitPreparedPractice = useCallback((value: PreparedPractice, transaction: AbortController) => {
    const resolution = configurationRef.current;
    if (preparation.current !== transaction || transaction.signal.aborted
      || resolution.status !== 'COMPLETE' || !matchesPreparationConfiguration(value.admission, resolution.configuration)
      || value.binding.resourcePlan !== planPracticeResources(resolution.configuration) || !value.binding.borrowRoots()) {
      value.binding.close(); return false;
    }
    prepared.current?.binding.close();
    prepared.current = value; preparation.current = null; setPreparedPractice(value);
    return true;
  }, []);
  const handoffToReview = useCallback((completion: ContinuousPracticeCompletion) => {
    if (!prepared.current || prepared.current.admission.configuration.mode !== 'CONTINUOUS_PLAY'
      || completion.result.inputSource !== prepared.current.admission.configuration.inputSource) {
      throw new Error('Matching prepared Continuous Practice required for Review handoff.');
    }
    const session = createTransientReviewSession(completion, prepared.current.admission.source);
    clearPreparedPractice();
    const previous = review.current; review.current = session;
    setReviewSession(session); void releaseTransientReviewSession(previous);
    return session;
  }, [clearPreparedPractice]);
  const lifetime = useRef(0);
  const releaseEnvironment = useCallback(() => {
    const retiring = ++lifetime.current;
    queueMicrotask(() => { if (retiring === lifetime.current) { clearPreparedPractice(); void clearReviewSession(); void environment.dispose(); } });
  }, [environment, clearPreparedPractice, clearReviewSession]);
  useEffect(() => {
    const epoch = ++lifetime.current;
    queueMicrotask(() => {
      if (epoch !== lifetime.current) return;
      let restored: PracticePreferenceProfile;
      try { restored = readPracticePreferences(window.localStorage); }
      catch { restored = emptyPracticePreferences; }
      configurationRef.current = resolvePracticeConfiguration(restored);
      setProfile(restored);
      setHydrated(true);
    });
    return releaseEnvironment;
  }, [environment, releaseEnvironment]);
  const updateProfile = useCallback((next: PracticePreferenceProfile) => {
    const nextResolution = resolvePracticeConfiguration(next);
    const previous = configurationRef.current;
    if (previous.status !== nextResolution.status || (previous.status === 'COMPLETE' && nextResolution.status === 'COMPLETE'
      && (previous.configuration.mode !== nextResolution.configuration.mode
        || previous.configuration.inputSource !== nextResolution.configuration.inputSource
        || previous.configuration.recordingMode !== nextResolution.configuration.recordingMode))) clearPreparedPractice();
    configurationRef.current = nextResolution;
    setProfile(next);
    try { writePracticePreferences(window.localStorage, next); } catch { /* Browser storage access can itself be denied. */ }
  }, [clearPreparedPractice]);
  const resolution = useMemo(() => resolvePracticeConfiguration(profile), [profile]);
  const configuration = resolution.status === 'COMPLETE' ? resolution.configuration : null;
  const resourcePlan = useMemo(() => configuration ? planPracticeResources(configuration) : null, [configuration]);
  return { profile, updateProfile, hydrated, configuration, resolution, resourcePlan, environment,
    reviewSession, handoffToReview, clearReviewSession,
    preparedPractice, beginPreparation, commitPreparedPractice, clearPreparedPractice,
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
