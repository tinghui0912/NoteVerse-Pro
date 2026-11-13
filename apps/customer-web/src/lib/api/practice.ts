import { practiceScoreRevisionBundleGet } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';


async function getPracticeBundle(
  scoreId: string,
  revisionId: string,
  includeNotation: boolean,
  signal?: AbortSignal,
) {
  return responseData(practiceScoreRevisionBundleGet({ ...customerTransport.authenticated, path: { score_id: scoreId, revision_id: revisionId }, query: { include_notation: includeNotation }, signal }));
}

export const practiceApi = { getPracticeBundle };
