'use client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
import { practiceLocation } from '@/lib/practice/configuration/practice-location';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/kernel/session';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';
import { requirementFingerprint } from '@/lib/practice/readiness/requirements';

export default function PracticeSetupPage() {
  const workspace = usePracticeWorkspace(), t = useTranslations('practice');
  const params = useParams<{ id: string }>(), query = useSearchParams(), router = useRouter();
  const { profile, updateProfile, readiness } = workspace;
  const checking = readiness.status === 'CHECKING';
  const currentRequirements = workspace.requirements ?? [];
  const currentReadiness = readiness.fingerprint === requirementFingerprint(currentRequirements);
  const enter = () => router.replace(practiceLocation(params.id, 'practice', query.get('practiceRevisionId')));
  return <main className="mx-auto max-w-2xl space-y-6 p-6" data-testid="practice-setup">
    <h1 className="text-2xl font-semibold">{t('setupTitle')}</h1>
    <p>{t('setupDescription')}</p>
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
    {profile.mode === 'CONTINUOUS_PLAY' && <>
      <fieldset disabled={checking} className="space-y-2"><legend>{t('setupRecording')}</legend>
        {(['OFF', 'AUDIO', 'VIDEO'] as PracticeRecordingMode[]).map(recordingMode => <button key={recordingMode} type="button"
          className="mr-3 rounded border p-3 aria-pressed:bg-orange-100" aria-pressed={profile.continuous.recordingMode === recordingMode}
          onClick={() => updateProfile({ ...profile, continuous: { ...profile.continuous, recordingMode } })}>
          {t(recordingMode === 'OFF' ? 'setupRecordingOff' : recordingMode === 'AUDIO' ? 'setupRecordingAudio' : 'setupRecordingVideo')}</button>)}
      </fieldset>
      <label className="flex gap-2"><input type="checkbox" checked={profile.continuous.liveFeedbackEnabled}
        onChange={event => updateProfile({ ...profile, continuous: { ...profile.continuous, liveFeedbackEnabled: event.target.checked } })} />{t('liveNoteFeedback')}</label>
    </>}
    <section aria-live="polite" className="space-y-2">
      {currentRequirements.map(key => <p key={key}>
        {t(`setupComponent_${key}`)}: {t(!currentReadiness ? 'setupNotPrepared' : readiness.components[key] === 'READY' ? 'setupReady'
          : readiness.components[key] === 'BLOCKED' ? 'setupBlocked' : 'setupChecking')}
        {currentReadiness && key === 'acousticEngine' && readiness.components[key] === 'CHECKING' && readiness.progress !== null ? ` ${readiness.progress}%` : ''}
      </p>)}
      {currentReadiness && readiness.status === 'BLOCKED' && <><p role="alert">{t('setupFailure')}</p><details><summary>{t('setupTechnicalDetails')}</summary><code>{readiness.reason}</code></details></>}
    </section>
    <button type="button" className="rounded bg-orange-600 px-5 py-3 text-white disabled:opacity-50"
      disabled={!workspace.configuration || checking || !workspace.hydrated}
      onClick={() => { if (workspace.ready) enter(); else void workspace.prepare().then(() => {
        if (workspace.requirements && workspace.environment.matches(workspace.requirements)) enter();
      }); }}>{t(workspace.ready ? 'setupContinue' : checking ? 'setupChecking' : 'setupPrepare')}</button>
  </main>;
}
