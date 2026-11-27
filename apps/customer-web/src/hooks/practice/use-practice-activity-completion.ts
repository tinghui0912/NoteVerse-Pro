import { useCallback, useRef } from 'react';
import { practiceApi } from '@/lib/api';
import { reportClientError } from '@/lib/observability';
import { practiceActivityRequestFromCompletion } from '@/lib/practice/activity/completion-projection';

/** Best-effort personal persistence never owns local musical completion or Review. */
export function usePracticeActivityCompletion() {
  const submitted = useRef(new Set<string>());
  return useCallback((snapshot: Parameters<typeof practiceActivityRequestFromCompletion>[0]) => {
    try {
      const request = practiceActivityRequestFromCompletion(snapshot);
      if (!request || submitted.current.has(request.client_session_id)) return;
      submitted.current.add(request.client_session_id);
      void practiceApi.createActivity(request).catch(error => {
        reportClientError(error, { operation: 'practice.activity.create', mode: request.mode });
      });
    } catch (error) {
      reportClientError(error, { operation: 'practice.activity.create' });
    }
  }, []);
}
