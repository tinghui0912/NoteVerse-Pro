// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePracticeTargets } from './use-practice-targets';

const apiMocks = vi.hoisted(() => ({
  getPracticeTargets: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  practiceApi: {
    getPracticeTargets: (...args: unknown[]) => apiMocks.getPracticeTargets(...args),
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

describe('usePracticeTargets', () => {
  beforeEach(() => {
    apiMocks.getPracticeTargets.mockReset();
    apiMocks.getPracticeTargets.mockResolvedValue({
      data: {
        score_id: 'score-1',
        revision_id: 'revision-1',
        targets: [
          {
            index: 0,
            group_id: 'entry-1',
            onset_beat: 3,
            event_ids: ['event-1'],
            render_note_ids: ['note-1'],
            pitches: ['C4'],
            measure_numbers: ['2'],
            staff_ids: ['1'],
            voice_ids: ['1'],
          },
        ],
      },
    });
  });

  it('loads revision-scoped practice targets through the practice API facade', async () => {
    const { result } = renderHook(
      () => usePracticeTargets('score-1', 'revision-1'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMocks.getPracticeTargets).toHaveBeenCalledWith(
      'score-1',
      'revision-1',
      expect.any(AbortSignal)
    );
    expect(result.current.data?.data?.targets?.[0]).toMatchObject({
      index: 0,
      group_id: 'entry-1',
      render_note_ids: ['note-1'],
    });
  });

  it('does not request targets until a revision is available', () => {
    renderHook(() => usePracticeTargets('score-1', null), { wrapper });

    expect(apiMocks.getPracticeTargets).not.toHaveBeenCalled();
  });
});
