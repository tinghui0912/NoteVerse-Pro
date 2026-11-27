import type { PracticeActivityCreateRequest } from '@/generated/api';
import { practiceActivityCreate, practiceScoreRevisionBundleGet } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';


async function getPracticeBundle(
  scoreId: string,
  revisionId: string,
  includeNotation: boolean,
  signal?: AbortSignal,
) {
  return responseBody(practiceScoreRevisionBundleGet({ ...customerTransport.authenticated, path: { score_id: scoreId, revision_id: revisionId }, query: { include_notation: includeNotation }, signal }));
}

export const practiceApi = {
  getPracticeBundle,
  createActivity: (body: PracticeActivityCreateRequest) =>
    responseBody(practiceActivityCreate({ ...customerTransport.authenticated, body })),
};
