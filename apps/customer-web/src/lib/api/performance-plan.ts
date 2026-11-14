import type { PerformancePlanRequest } from '@/generated/api';
import { playbackPerformancePlanCreate } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';
import { decodePerformancePlan } from '@/lib/score/performance/plan';

export async function compilePerformancePlan(
  musicxml: string,
  signal?: AbortSignal
) {
  const request: PerformancePlanRequest = { musicxml };
  const response = await responseBody(playbackPerformancePlanCreate({ ...customerTransport.authenticated, body: request, signal }));
  return decodePerformancePlan(response);
}
