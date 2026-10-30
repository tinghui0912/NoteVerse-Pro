'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { usePracticeSource } from '@/hooks/practice/use-practice-source';
import { SourceFailure } from '@/lib/practice/failure/causal-failure';
import { useTranslations } from 'next-intl';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
import { practiceLocation } from '@/lib/practice/configuration/practice-location';
import type { PracticeConfiguration } from '@/lib/practice/configuration/preferences';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/kernel/session';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';
import { qualificationFingerprint } from '@/lib/practice/planning/resource-plan';
import { evaluatePracticeInputCapabilities, getSelectedInputCapability } from '@/lib/practice/input-capability';

type Preparation = {
  revisionId: string;
  configuration: PracticeConfiguration;
  stage: 'SOURCE' | 'QUALIFYING' | 'READY' | 'BLOCKED';
  failure: 'SOURCE' | 'CAPABILITY' | 'ENVIRONMENT' | null;
};

export default function PracticeSetupPage() {
  const workspace = usePracticeWorkspace(), t = useTranslations('practice');
  const params = useParams<{ id: string }>(), router = useRouter();
  const source = usePracticeSource(params.id, { loadNotation: false, enabled: false });
  const { profile, updateProfile, readiness, configuration, resourcePlan, environment } = workspace;
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [invalidRevision, setInvalidRevision] = useState<string | null>(null);
  const generation = useRef(0), inFlight = useRef<number | null>(null);
  useEffect(() => () => { generation.current++; inFlight.current = null; }, [params.id, source.revisionId, configuration, environment]);
  const current = preparation?.revisionId === source.revisionId && preparation?.configuration === configuration ? preparation : null;
  const checking = current?.stage === 'SOURCE' || current?.stage === 'QUALIFYING';
  const invalid = invalidRevision !== null && invalidRevision === source.revisionId;
  const currentRequirements = resourcePlan?.qualification ?? [];
  const currentReadiness = Boolean(current && current.stage !== 'SOURCE' && current.failure !== 'SOURCE'
    && current.failure !== 'CAPABILITY' && readiness.fingerprint === qualificationFingerprint(currentRequirements));

  const prepare = async () => {
    const revisionId = source.revisionId;
    if (inFlight.current !== null || invalid || !workspace.hydrated || !configuration || !resourcePlan
      || !revisionId || !source.canPractice || source.scoreQuery.isError) return;
    const token = ++generation.current;
    inFlight.current = token;
    const captured = { revisionId, configuration };
    const active = () => generation.current === token;
    setPreparation({ ...captured, stage: 'SOURCE', failure: null });
    let failure: Preparation['failure'] = 'SOURCE';
    try {
      const admitted = await source.sourceQuery.refetch();
      if (!active()) return;
      if (admitted.isError || !admitted.data) {
        if (admitted.error instanceof SourceFailure && admitted.error.code === 'INVALID_SCORE') setInvalidRevision(revisionId);
        setPreparation({ ...captured, stage: 'BLOCKED', failure: 'SOURCE' });
        return;
      }
      failure = 'CAPABILITY';
      const capability = getSelectedInputCapability(resourcePlan, evaluatePracticeInputCapabilities());
      if (!capability.supported) {
        setPreparation({ ...captured, stage: 'BLOCKED', failure: 'CAPABILITY' });
        return;
      }
      failure = 'ENVIRONMENT';
      setPreparation({ ...captured, stage: 'QUALIFYING', failure: null });
      await environment.requalify(resourcePlan.qualification);
      if (!active()) return;
      if (!environment.matches(resourcePlan.qualification)) {
        setPreparation({ ...captured, stage: 'BLOCKED', failure: 'ENVIRONMENT' });
        return;
      }
      setPreparation({ ...captured, stage: 'READY', failure: null });
      router.replace(practiceLocation(params.id, 'practice', revisionId));
    } catch (error) {
      if (active()) {
        if (failure === 'SOURCE' && error instanceof SourceFailure && error.code === 'INVALID_SCORE') setInvalidRevision(revisionId);
        setPreparation({ ...captured, stage: 'BLOCKED', failure });
      }
    } finally {
      if (inFlight.current === token) inFlight.current = null;
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
      : !source.canPractice ? <p role="alert">{t('accessDeniedDesc')}</p>
      : current?.failure === 'SOURCE' || source.scoreQuery.isError ? <p role="alert">{t('scoreLoadFailed')}</p>
      : current?.stage === 'SOURCE' ? <p role="status">{t('scoreLoading')}</p> : null}
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
        {t(`setupComponent_${key}`)}: {t(!currentReadiness ? 'setupNotPrepared' : readiness.components[key] === 'READY' ? 'setupReady'
          : readiness.components[key] === 'BLOCKED' ? 'setupBlocked' : 'setupChecking')}
        {currentReadiness && key === 'acousticEngine' && readiness.components[key] === 'CHECKING' && readiness.progress !== null ? ` ${readiness.progress}%` : ''}
      </p>)}
      {(current?.failure === 'CAPABILITY' || current?.failure === 'ENVIRONMENT') && <p role="alert">{t('setupFailure')}</p>}
      {currentReadiness && readiness.status === 'BLOCKED' && <details><summary>{t('setupTechnicalDetails')}</summary><code>{readiness.reason}</code></details>}
    </section>
    <button type="button" className="rounded bg-orange-600 px-5 py-3 text-white disabled:opacity-50"
      disabled={invalid || !source.revisionId || !source.canPractice || source.scoreQuery.isError || !configuration || checking || !workspace.hydrated}
      aria-busy={checking} onClick={() => { void prepare(); }}>{t('setupStartPractice')}</button>
  </main>;
}
