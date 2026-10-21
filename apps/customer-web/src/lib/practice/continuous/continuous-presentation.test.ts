import { describe, expect, it } from 'vitest';
import { continuousControllerView } from './continuous-presentation';
import { continuousErrorCode, continuousErrorMessageKeys } from './continuous-errors';
import type { ContinuousControllerSnapshot } from './continuous-practice-controller';
import { resolvePracticeStatusView } from '../../../components/practice/practice-status';

describe('Continuous presentation and safe product errors', () => {
  it('accounts for every session and analysis state without transport authority', () => {
    for (const session of ['IDLE', 'PREPARING', 'ACTIVE', 'FINALIZING', 'COMPLETE', 'FAILED_BEFORE_START', 'FAILED', 'DISPOSED'] as const) {
      for (const analysis of ['PREPARING', 'PREROLL', 'RUNNING', 'PAUSED', 'DRAINING', 'COMPLETE', 'FAILED'] as const) {
        const snapshot: ContinuousControllerSnapshot = { session, analysis, transport: null, recording: null,
          inputError: session.startsWith('FAILED') ? 'MICROPHONE_SOURCE_LOST' : null, analysisError: null,
          evaluation: null, completed: null, sessionSnapshot: null };
        const before = JSON.stringify(snapshot), view = continuousControllerView(snapshot);
        expect(view.inputState).toBe(session.startsWith('FAILED') ? 'ERROR' : session === 'PREPARING' ? 'STARTING' : 'IDLE');
        expect(JSON.stringify(snapshot)).toBe(before);
      }
    }
  });
  it('maps public categories to localized UI messages without raw diagnostics', () => {
    for (const code of Object.keys(continuousErrorMessageKeys)) {
      const view = resolvePracticeStatusView({ lifecycle: 'ENDED', inputState: 'ERROR', inputError: code, sessionMode: 'CONTINUOUS_PLAY' });
      expect(view.messageKey).toBe(continuousErrorMessageKeys[code as keyof typeof continuousErrorMessageKeys]);
      expect(view.customMessage).toBeUndefined();
    }
    expect(continuousErrorCode(new DOMException('private detail', 'NotAllowedError'), 'ANALYSIS_FAILED')).toBe('MICROPHONE_PERMISSION_DENIED');
    expect(continuousErrorCode(new Error('private stack and URL'), 'ANALYSIS_FAILED')).toBe('ANALYSIS_FAILED');
  });
});
