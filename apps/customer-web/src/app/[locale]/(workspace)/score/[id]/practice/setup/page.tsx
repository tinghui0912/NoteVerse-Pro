'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { usePracticeRouteScore } from '@/hooks/practice/use-practice-route-score';
import { admitPracticeBundle } from '@/lib/practice/bundle/admit-practice-bundle';
import { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import { validatePracticeResources } from '@/lib/practice/environment/validate-practice-resources';
import { BundleFailure } from '@/lib/practice/failure/causal-failure';
import { useTranslations } from 'next-intl';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
import { practiceLocation } from '@/lib/practice/configuration/practice-location';
import type { PracticeConfiguration } from '@/lib/practice/configuration/preferences';
import type { PracticeMode } from '@/lib/practice/planning/intent';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';
import { planPracticeResources, type PracticeQualificationRequirement } from '@/lib/practice/planning/resource-plan';

type Preparation = {
  revisionId: string;
  configuration: PracticeConfiguration;
  stage: 'BUNDLE' | 'ACQUIRING' | 'VALIDATING' | 'FAILED';
  failure: 'BUNDLE' | 'RESOURCES' | null;
  components?: Partial<Record<PracticeQualificationRequirement, 'READY'>>;
  progress?: number | null;
};

export default function PracticeSetupPage() {
  const workspace = usePracticeWorkspace(), t = useTranslations('practice');
  const params = useParams<{ id: string }>(), router = useRouter();
  const route = usePracticeRouteScore(params.id);
  const { profile, updateProfile, configuration, resourcePlan, environment, beginPreparation, commitPreparedPractice, clearPreparedPractice } = workspace;
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [invalidRevision, setInvalidRevision] = useState<string | null>(null);
  const transaction = useRef<AbortController | null>(null);
  useEffect(() => {
    clearPreparedPractice();
    return () => { transaction.current?.abort(); transaction.current = null; };
  }, [params.id, route.revisionId, configuration?.mode, configuration?.inputSource, configuration?.recordingMode, clearPreparedPractice]);
  const current = preparation?.revisionId === route.revisionId && preparation?.configuration === configuration ? preparation : null;
  const checking = current?.stage === 'BUNDLE' || current?.stage === 'ACQUIRING' || current?.stage === 'VALIDATING';
  const invalid = invalidRevision !== null && invalidRevision === route.revisionId;
  const currentRequirements = resourcePlan?.qualification ?? [];
  const prepare = async () => {
    const revisionId = route.revisionId;
    if (transaction.current || invalid || !workspace.hydrated || !configuration
      || !revisionId || !route.pinned || !route.canPractice || route.scoreQuery.isError) return;
    const command = beginPreparation(); transaction.current = command;
    const captured = { revisionId, configuration };
    const active = () => transaction.current === command && !command.signal.aborted;
    let binding: PracticeResourceBinding | null = null;
    let committed = false;
    let failure: Preparation['failure'] = 'BUNDLE';
    setPreparation({ ...captured, stage: 'BUNDLE', failure: null });
    try {
      const admitted = await admitPracticeBundle(params.id, revisionId, command.signal);
      if (!active()) return;
      failure = 'RESOURCES';
      const resources = planPracticeResources(configuration);
      setPreparation({ ...captured, stage: 'ACQUIRING', failure: null });
      binding = new PracticeResourceBinding(resources);
      const owner = binding;
      const close = () => owner.close();
      command.signal.addEventListener('abort', close, { once: true });
      try {
        await binding.open();
        if (!active()) return;
        const roots = binding.borrowRoots();
        if (!roots) throw new Error('PRACTICE_RESOURCES_UNAVAILABLE');
        setPreparation({ ...captured, stage: 'VALIDATING', failure: null });
        await validatePracticeResources({ plan: resources, roots, environment, signal: command.signal,
          onComponent: key => { if (active()) setPreparation(previous => previous ? { ...previous, components: { ...previous.components, [key]: 'READY' } } : previous); },
          onProgress: progress => { if (active()) setPreparation(previous => previous ? { ...previous, progress } : previous); },
        });
        if (!active()) return;
        const admission = Object.freeze({ bundle: admitted, configuration: Object.freeze({
          mode: configuration.mode, inputSource: configuration.inputSource, recordingMode: configuration.recordingMode,
        }) });
        committed = commitPreparedPractice(Object.freeze({ admission, binding }), command);
        if (committed) router.replace(practiceLocation(params.id, 'practice', revisionId));
      } finally { command.signal.removeEventListener('abort', close); }
    } catch (error) {
      if (active()) {
        if (failure === 'BUNDLE' && error instanceof BundleFailure && error.code === 'INVALID_SCORE') setInvalidRevision(revisionId);
        setPreparation({ ...captured, stage: 'FAILED', failure });
      }
    } finally {
      if (!committed) binding?.close();
      if (transaction.current === command) transaction.current = null;
    }
  };

  return <main className="mx-auto max-w-2xl space-y-6 p-6" data-testid="practice-setup">
    <nav aria-label={t('backToScore')}>
      <button type="button" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        onClick={() => router.push(`/score/${params.id}`)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('backToScore')}
      </button>
    </nav>
    <h1 className="text-2xl font-semibold">{t('setupTitle')}</h1>
    <p>{t('setupDescription')}</p>
    {invalid ? <p role="alert">{t('scoreInvalid')}</p>
      : !route.canPractice ? <p role="alert">{t('accessDeniedDesc')}</p>
      : current?.failure === 'BUNDLE' || route.scoreQuery.isError ? <p role="alert">{t('scoreLoadFailed')}</p>
      : current?.stage === 'BUNDLE' ? <p role="status">{t('scoreLoading')}</p> : null}
    <fieldset disabled={checking} className="space-y-2"><legend>{t('settingsMode')}</legend>
      {(['STEP_BY_STEP', 'CONTINUOUS_PLAY'] as PracticeMode[]).map(mode => <button key={mode} type="button"
        className="mr-3 rounded border p-3 aria-pressed:bg-orange-100" aria-pressed={profile.mode === mode}
        onClick={() => updateProfile({ ...profile, mode })}>{t(mode === 'STEP_BY_STEP' ? 'settingStepByStep' : 'settingContinuousPlay')}</button>)}
    </fieldset>
    <fieldset disabled={checking} className="space-y-2"><legend>{t('settingsInput')}</legend>
      {(['MICROPHONE', 'MIDI'] as PracticeInputSource[]).map(inputSource => <button key={inputSource} type="button"
        className="mr-3 rounded border p-3 aria-pressed:bg-orange-100" aria-pressed={profile.inputSource === inputSource}
        onClick={() => updateProfile({ ...profile, inputSource })}>{t(inputSource === 'MICROPHONE' ? 'settingMicrophone' : 'settingMidi')}</button>)}
    </fieldset>
    {profile.mode === 'CONTINUOUS_PLAY' && <fieldset disabled={checking} className="space-y-2"><legend>{t('setupRecording')}</legend>
      {(['OFF', 'AUDIO', 'VIDEO'] as PracticeRecordingMode[]).map(recordingMode => <button key={recordingMode} type="button"
        className="mr-3 rounded border p-3 aria-pressed:bg-orange-100" aria-pressed={profile.continuous.recordingMode === recordingMode}
        onClick={() => updateProfile({ ...profile, continuous: { ...profile.continuous, recordingMode } })}>
        {t(recordingMode === 'OFF' ? 'setupRecordingOff' : recordingMode === 'AUDIO' ? 'setupRecordingAudio' : 'setupRecordingVideo')}</button>)}
    </fieldset>}
    <section aria-live="polite" className="space-y-2">
      {currentRequirements.map(key => <p key={key}>
        {t(`setupComponent_${key}`)}: {t(!current || current.stage === 'BUNDLE' ? 'setupNotPrepared'
          : current.stage === 'FAILED' ? 'setupBlocked' : current.components?.[key] === 'READY' ? 'setupReady' : 'setupChecking')}
        {key === 'acousticEngine' && current?.stage === 'VALIDATING' && current.progress != null ? ` ${current.progress}%` : ''}
      </p>)}
      {current?.failure === 'RESOURCES' && <p role="alert">{t('setupFailure')}</p>}
    </section>
    <button type="button" className="rounded bg-orange-600 px-5 py-3 text-white disabled:opacity-50"
      disabled={invalid || !route.revisionId || !route.canPractice || route.scoreQuery.isError || !configuration || checking || !workspace.hydrated}
      aria-busy={checking} onClick={() => { void prepare(); }}>{t('setupStartPractice')}</button>
  </main>;
}
