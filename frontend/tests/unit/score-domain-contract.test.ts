import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface ScoreDomainContract {
  api_namespace: string;
  capabilities: string[];
  examples: {
    create_practice_session_request: Record<string, string>;
    create_revision_request: Record<string, string>;
    score_capabilities: Record<string, boolean>;
  };
  identities: Record<string, string>;
  invariants: Record<string, boolean>;
}

function loadContract() {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), '../backend/docs/contracts/score-domain-v1.json'),
      'utf8'
    )
  ) as ScoreDomainContract;
}

describe('score domain v1 contract', () => {
  it('separates processing, score, and revision identities', () => {
    const contract = loadContract();

    expect(contract.api_namespace).toBe('/api/v1');
    expect(contract.identities).toEqual({
      submission_and_polling: 'job_id',
      review: 'job_id',
      results_editor_history_sharing: 'score_id',
      practice_and_publication_snapshot: 'revision_id',
    });
    expect(contract.examples.create_practice_session_request).toEqual({
      score_id: 'score-uuid',
      revision_id: 'revision-uuid',
    });
    expect(contract.examples.create_revision_request).toHaveProperty(
      'base_revision_id',
      'revision-uuid'
    );
  });

  it('keeps frontend capabilities aligned with backend-enforced policy hints', () => {
    const contract = loadContract();

    expect(Object.keys(contract.examples.score_capabilities).sort()).toEqual(
      [...contract.capabilities].sort()
    );
    expect(contract.invariants).toMatchObject({
      anonymous_edit_is_forbidden: true,
      bookmark_grants_access: false,
      publication_pins_revision: true,
      public_access_is_read_only: true,
      revision_history_is_linear: true,
    });
  });
});
