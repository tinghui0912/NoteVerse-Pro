// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import canonicalArtifactJson from '@/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import { usePracticeScoreArtifact } from './use-practice-score-artifact';

const apiMocks = vi.hoisted(() => ({
  getPracticeScoreArtifact: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  practiceApi: {
    getPracticeScoreArtifact: (...args: unknown[]) => apiMocks.getPracticeScoreArtifact(...args),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePracticeScoreArtifact', () => {
  beforeEach(() => {
    apiMocks.getPracticeScoreArtifact.mockReset();
    apiMocks.getPracticeScoreArtifact.mockResolvedValue({
      data: canonicalArtifactJson,
    });
  });

  it('loads and validates the PracticeScoreArtifact through the API client', async () => {
    const { result } = renderHook(
      () => usePracticeScoreArtifact('score-1', 'revision-1'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMocks.getPracticeScoreArtifact).toHaveBeenCalledWith(
      'score-1',
      'revision-1',
      expect.any(AbortSignal)
    );
    expect(result.current.data?.artifactId).toBe(canonicalArtifactJson.artifactId);
    expect(result.current.data?.expectedPracticeGroups).toHaveLength(5);
  });

  it('does not request artifact until revision is available', () => {
    renderHook(() => usePracticeScoreArtifact('score-1', null), { wrapper });

    expect(apiMocks.getPracticeScoreArtifact).not.toHaveBeenCalled();
  });
});
