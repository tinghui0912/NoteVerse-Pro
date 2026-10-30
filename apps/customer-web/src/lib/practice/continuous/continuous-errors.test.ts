import { describe, expect, it } from 'vitest';
import { continuousErrorCode, continuousErrorMessageKeys } from './continuous-errors';
import { resolvePracticeStatusView } from '../../../components/practice/practice-status';

describe('Continuous presentation and safe product errors', () => {
  it('maps public categories to localized UI messages without raw diagnostics', () => {
    for (const code of Object.keys(continuousErrorMessageKeys)) {
      const view = resolvePracticeStatusView({ lifecycle: 'ERROR', inputState: 'ERROR', inputError: code, sessionMode: 'CONTINUOUS_PLAY' });
      expect(view.messageKey).toBe(continuousErrorMessageKeys[code as keyof typeof continuousErrorMessageKeys]);
      expect(view.customMessage).toBeUndefined();
    }
    expect(continuousErrorCode(new DOMException('private detail', 'NotAllowedError'), 'ANALYSIS_FAILED')).toBe('MICROPHONE_PERMISSION_DENIED');
    expect(continuousErrorCode(new Error('private stack and URL'), 'ANALYSIS_FAILED')).toBe('ANALYSIS_FAILED');
  });
});
