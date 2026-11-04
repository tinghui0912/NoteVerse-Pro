import type {
  PerformancePlanRead,
  PerformancePlanRequest,
} from '@/generated/api';
import { apiClient } from '@/lib/api-client';
import { decodePerformancePlan } from '@/lib/score/performance/plan';

export async function compilePerformancePlan(
  musicxml: string,
  signal?: AbortSignal
) {
  const request: PerformancePlanRequest = { musicxml };
  const response = await apiClient.post<PerformancePlanRead>(
    '/playback/performance-plan',
    request,
    { signal }
  );
  return decodePerformancePlan(response);
}
