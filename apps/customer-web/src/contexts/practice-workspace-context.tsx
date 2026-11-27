'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  emptyPracticePreferences,
  resolvePracticeConfiguration,
  type PracticePreferenceProfile,
} from '@/lib/practice/configuration/preferences';
import {
  readPracticePreferences,
  writePracticePreferences,
} from '@/lib/practice/configuration/preference-storage';
import { planPracticeResources, samePracticeResourcePlan } from '@/lib/practice/planning/resource-plan';
import type { PreparedPractice } from '@/lib/practice/preparation/prepared-practice';
import { createPracticePreparationKey, samePracticePreparationKey, preparationKeyMatchesConfiguration, type PracticePreparationKey } from '@/lib/practice/preparation/preparation-key';
import { PracticePreparationTransaction } from '@/lib/practice/preparation/preparation-transaction';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import {
  releaseTransientReviewSession,
  createTransientReviewSession,
  type TransientReviewSession,
} from '@/lib/practice/review/transient-review-session';
import type { ContinuousPracticeCompletion } from '@/lib/practice/continuous/completion';
import type { PracticeScope } from '@/lib/practice/planning/scope';
import type { PracticeTempoSelection } from '@/lib/practice/planning/tempo';

function useWorkspaceState(createEnvironment: () => PracticeEnvironment) {
  const [environment] = useState(createEnvironment);
  const [profile, setProfile] = useState<PracticePreferenceProfile>(
    emptyPracticePreferences,
  );
  const [hydrated, setHydrated] = useState(false);
  const [scope, setScope] = useState<PracticeScope>({ kind: 'FULL' });
  const [tempoSelection, setTempoSelection] = useState<PracticeTempoSelection>({
    mode: 'SCORE',
  });
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [preparedPractice, setPreparedPractice] =
    useState<PreparedPractice | null>(null);
  const [reviewSession, setReviewSession] =
    useState<TransientReviewSession | null>(null);
  const review = useRef<TransientReviewSession | null>(null);
  const reviewVisit = useRef(0);
  const clearReviewSession = useCallback(() => {
    ++reviewVisit.current;
    const previous = review.current;
    review.current = null;
    setReviewSession(null);
    return releaseTransientReviewSession(previous);
  }, []);
  const prepared = useRef<PreparedPractice | null>(null);
  const preparation = useRef<PracticePreparationTransaction | null>(null);
  const preparationGeneration = useRef(0);
  const target = useRef<PracticePreparationKey | null>(null);
  const configurationRef = useRef<
    ReturnType<typeof resolvePracticeConfiguration>
  >(resolvePracticeConfiguration(profile));
  const clearPreparedPractice = useCallback(() => {
    preparation.current?.abort();
    preparation.current = null;
    prepared.current?.binding.close();
    prepared.current = null;
    setPreparedPractice(null);
  }, []);
  const enterSetup = useCallback((key: PracticePreparationKey | null) => {
    clearPreparedPractice();
    void clearReviewSession();
    target.current = key;
  }, [clearPreparedPractice, clearReviewSession]);
  const preparedFor = useCallback((key: PracticePreparationKey | null) => {
    return samePracticePreparationKey(preparedPractice?.key, key) ? preparedPractice : null;
  }, [preparedPractice]);
  const enterPractice = useCallback((key: PracticePreparationKey | null) => {
    void clearReviewSession();
    if (!samePracticePreparationKey(target.current, key)) clearPreparedPractice();
    target.current = key;
    return samePracticePreparationKey(prepared.current?.key, key) ? prepared.current : null;
  }, [clearPreparedPractice, clearReviewSession]);
  const enterReview = useCallback((scoreId: string) => {
    clearPreparedPractice();
    if (review.current?.result.executed.bundle.binding.scoreId !== scoreId) void clearReviewSession();
    const visit = ++reviewVisit.current;
    // Immediate effect remount acquires a fresh visit before this disposal runs.
    return () => queueMicrotask(() => {
      if (visit === reviewVisit.current) void clearReviewSession();
    });
  }, [clearPreparedPractice, clearReviewSession]);
  const beginPreparation = useCallback((key: PracticePreparationKey) => {
    const resolution = configurationRef.current;
    if (!preparationKeyMatchesConfiguration(key, resolution.status === 'COMPLETE' ? resolution.configuration : null)) {
      throw new Error('Current resource choices required for preparation.');
    }
    void clearReviewSession();
    clearPreparedPractice();
    target.current = key;
    const transaction = new PracticePreparationTransaction(++preparationGeneration.current, key);
    preparation.current = transaction;
    return transaction;
  }, [clearPreparedPractice, clearReviewSession]);
  const cancelPreparation = useCallback((transaction: PracticePreparationTransaction) => {
    if (preparation.current?.id !== transaction.id) return;
    preparation.current.abort();
    preparation.current = null;
  }, []);
  const commitPreparedPractice = useCallback(
    (value: PreparedPractice, transaction: PracticePreparationTransaction) => {
      const resolution = configurationRef.current;
      if (
        preparation.current?.id !== transaction.id ||
        transaction.signal.aborted ||
        !samePracticePreparationKey(target.current, transaction.key) ||
        !samePracticePreparationKey(transaction.key, value.key) ||
        !preparationKeyMatchesConfiguration(value.key, resolution.status === 'COMPLETE' ? resolution.configuration : null) ||
        value.bundle.binding.scoreId !== value.key.scoreId ||
        value.bundle.binding.revisionId !== value.key.revisionId ||
        !samePracticeResourcePlan(value.binding.resourcePlan, planPracticeResources(value.key)) ||
        !value.binding.borrowRoots()
      ) {
        value.binding.close();
        return false;
      }
      prepared.current?.binding.close();
      prepared.current = value;
      preparation.current = null;
      setPreparedPractice(value);
      return true;
    }, [],
  );
  const handoffToReview = useCallback(
    (completion: ContinuousPracticeCompletion, key: PracticePreparationKey) => {
      if (
        !prepared.current ||
        !samePracticePreparationKey(prepared.current.key, key) ||
        !samePracticePreparationKey(target.current, key) ||
        prepared.current.key.mode !== 'CONTINUOUS_PLAY' ||
        completion.result.inputKind !==
          prepared.current.key.inputSource
      ) {
        throw new Error(
          'Matching prepared Continuous Practice required for Review handoff.',
        );
      }
      const session = createTransientReviewSession(
        completion,
        prepared.current.bundle,
      );
      clearPreparedPractice();
      ++reviewVisit.current;
      const previous = review.current;
      review.current = session;
      setReviewSession(session);
      void releaseTransientReviewSession(previous);
      return session;
    },
    [clearPreparedPractice],
  );
  const lifetime = useRef(0);
  const releaseEnvironment = useCallback(() => {
    const retiring = ++lifetime.current;
    queueMicrotask(() => {
      if (retiring === lifetime.current) {
        clearPreparedPractice();
        void clearReviewSession();
        void environment.dispose();
      }
    });
  }, [environment, clearPreparedPractice, clearReviewSession]);
  useEffect(() => {
    const epoch = ++lifetime.current;
    queueMicrotask(() => {
      if (epoch !== lifetime.current) return;
      let restored: PracticePreferenceProfile;
      try {
        restored = readPracticePreferences(window.localStorage);
      } catch {
        restored = emptyPracticePreferences;
      }
      configurationRef.current = resolvePracticeConfiguration(restored);
      setProfile(restored);
      setHydrated(true);
    });
    return releaseEnvironment;
  }, [environment, releaseEnvironment]);
  const updateProfile = useCallback(
    (next: PracticePreferenceProfile) => {
      const nextResolution = resolvePracticeConfiguration(next);
      const key = target.current;
      if (key && !preparationKeyMatchesConfiguration(key, nextResolution.status === 'COMPLETE' ? nextResolution.configuration : null)) {
        clearPreparedPractice();
        target.current = nextResolution.status === 'COMPLETE'
          ? createPracticePreparationKey(key.scoreId, key.revisionId, nextResolution.configuration) : null;
      }
      configurationRef.current = nextResolution;
      setProfile(next);
      try {
        writePracticePreferences(window.localStorage, next);
      } catch {
        /* Browser storage access can itself be denied. */
      }
    },
    [clearPreparedPractice],
  );
  const resolution = useMemo(
    () => resolvePracticeConfiguration(profile),
    [profile],
  );
  const configuration =
    resolution.status === 'COMPLETE' ? resolution.configuration : null;
  const resourcePlan = useMemo(
    () => (configuration ? planPracticeResources(configuration) : null),
    [configuration],
  );
  return {
    profile,
    updateProfile,
    hydrated,
    configuration,
    resolution,
    resourcePlan,
    environment,
    reviewSession,
    handoffToReview,
    clearReviewSession,
    preparedPractice,
    enterSetup,
    enterPractice,
    enterReview,
    preparedFor,
    beginPreparation,
    cancelPreparation,
    commitPreparedPractice,
    clearPreparedPractice,
    scope,
    setScope,
    tempoSelection,
    setTempoSelection,
    metronomeEnabled,
    setMetronomeEnabled,
  };
}
const Workspace = createContext<ReturnType<typeof useWorkspaceState> | null>(
  null,
);
const browserEnvironment = () => new PracticeEnvironment();
export function PracticeWorkspaceProvider({
  children,
  createEnvironment = browserEnvironment,
}: {
  children: ReactNode;
  createEnvironment?: () => PracticeEnvironment;
}) {
  const workspace = useWorkspaceState(createEnvironment);
  return <Workspace.Provider value={workspace}>{children}</Workspace.Provider>;
}
export function usePracticeWorkspace() {
  const workspace = useContext(Workspace);
  if (!workspace) throw new Error('PRACTICE_WORKSPACE_REQUIRED');
  return workspace;
}
