import { DeviceFailure } from '../failure/causal-failure';
import { describe, expect, it } from 'vitest';
import { projectContinuousFailure, type ContinuousErrorCode, continuousErrorMessageKeys } from './continuous-errors';
import { resolvePracticeStatusView } from '../../../components/practice/practice-status';

describe('Continuous presentation and safe product errors', () => {
  it('maps public categories to localized UI messages without raw diagnostics', () => {
    for (const code of Object.keys(continuousErrorMessageKeys)) {
      const view = resolvePracticeStatusView({ lifecycle: 'ERROR', inputState: 'ERROR', inputError: code as ContinuousErrorCode, sessionMode: 'CONTINUOUS_PLAY' });
      expect(view.messageKey).toBe(continuousErrorMessageKeys[code as keyof typeof continuousErrorMessageKeys]);
      expect(view.customMessage).toBeUndefined();
    }
    expect(projectContinuousFailure(new DeviceFailure('PERMISSION_DENIED', 'MICROPHONE'), 'ACTIVE')).toBe('MICROPHONE_PERMISSION_DENIED');

  });
});
