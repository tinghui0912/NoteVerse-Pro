import { recordedPerformanceFixture } from '@/lib/practice/__fixtures__/recorded-performance';
import { artifact as videoArtifact } from '@/lib/practice/composite-video/__fixtures__/saved-take';
import { planPractice } from '@/lib/practice/planning/practice-plan';
import { recordedPerformance } from '@/lib/practice/recording/recorded-performance';
import type { ReadyPerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import type { ExecutedPerformance } from '@/lib/practice/run/executed-performance';
// @vitest-environment jsdom
import {
useDeletePerformanceTake,
useSavePerformanceTake,
} from '@/hooks/queries/use-performance-take-queries';
import {
performanceTakesApi,
type PerformanceTakeRead,
type PerformanceTakeTempoPlan,
type PerformanceTakeUploadReservationRead,
type RecordingTimebase,
} from '@/lib/api/performance-takes';
import { uploadMediaToSignedUrl } from '@/lib/http/direct-object-upload';
import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';
import { recordingSinkFixture } from '@/lib/practice/__fixtures__/recording-sink';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/http/direct-object-upload', () => ({ uploadMediaToSignedUrl: vi.fn() }));
vi.mock('@/lib/api/performance-takes', () => ({
  performanceTakesApi: {
    reserveUpload: vi.fn(),
    cancelUploadReservation: vi.fn(),
    finalizeTake: vi.fn(),
    listTakes: vi.fn(),
    getTake: vi.fn(),
    getPlaybackUrl: vi.fn(),
    deleteTake: vi.fn(),
  },
}));
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}
const tempoPlan: PerformanceTakeTempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [{ startTick: 0, bpm: 120, source: 'MUSICXML' }],
};
const recordingTimebase: RecordingTimebase = {
  nominalMediaDurationUs: 1000000,
  activeSegments: [
    {
      performanceStartUs: 0,
      performanceEndUs: 1000000,
      mediaStartUs: 0,
      mediaEndUs: 1000000,
    },
  ],
};
function createInput(
  overrides: {
    executed?: Partial<ExecutedPerformance>;
    recording?: Partial<ReadyPerformanceRecording>;
  } = {},
) {
  const artifact = {
    ...videoArtifact,
    notes: videoArtifact.notes.slice(0, 1),
    events: videoArtifact.events.slice(0, 1),
    moments: videoArtifact.moments.slice(0, 1),
    scoreEndTick: 4,
    scoreTempoSegments: [{ startTick: 0, bpm: 120 }],
  };
  const plan = planPractice(
    {
      binding: {
        scoreId: 'score-1',
        revisionId: 'revision-1',
        bundleId: 'source-1',
      },
      artifact,
    },
    {
      mode: 'CONTINUOUS_PLAY',
      inputSource: 'MIDI',
      recordingMode: 'OFF',
      scope: { kind: 'FULL' },
      tempoSelection: { mode: 'SCORE' },
      metronomeEnabled: false,
    },
  );
  const base = recordedPerformanceFixture(plan, {
    status: 'READY',
    kind: 'AUDIO',
    media: localMediaAssetFixture(
      new Blob(['RIFF....WAVE'], { type: 'audio/wav' }),
    ),
    mimeType: 'audio/wav',
    timebase: recordingTimebase,
  });
  return {
    clientRequestId: 'request-1',
    recordedPerformance: recordedPerformance(
      { ...base.executed, ...overrides.executed },
      { ...base.recording, ...overrides.recording },
    ),
  };
}
const savedTake: PerformanceTakeRead = {
  recording_media: { mime_type: 'audio/wav', byte_size: 12 },
  take_id: 'take-1',

  created_at: '2026-09-21T00:00:00Z',
  manifest: {
    artifact_id: videoArtifact.artifactId,
    score_title_snapshot: 'Etude',
    score_timebase: { ticks_per_quarter: 1 },
    tempo_plan: tempoPlan,
    recording_timebase: recordingTimebase,
    practice_binding: {
      bundle_id: 'source-1',
      score_id: 'score-1',
      revision_id: 'revision-1',
    },
    capture: {
      kind: 'AUDIO',
      mime_type: 'audio/wav',
      byte_size: 12,
    },
    scope: {
      kind: 'FULL',
      start_tick: 0,
      terminal_tick: 4,
    },
  },
};
function reservation(
  status: PerformanceTakeUploadReservationRead['status'] = 'RESERVED',
): PerformanceTakeUploadReservationRead {
  return {
    reservation_id: 'upload-reservation-1',
    take_id: savedTake.take_id,
    status,
    manifest: structuredClone(savedTake.manifest),
    upload_target:
      status === 'RESERVED'
        ? {
            url: 'https://objects.example/staging.wav',
            method: 'PUT',
            headers: { 'content-type': 'audio/wav' },
            expires_in: 3600,
          }
        : null,
    take: status === 'COMPLETED' ? savedTake : null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
    data: reservation(),
  } as never);
  vi.mocked(uploadMediaToSignedUrl).mockResolvedValue();
  vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
    data: savedTake,
  } as never);
});
async function save() {
  const { result } = renderHook(() => useSavePerformanceTake(), {
    wrapper: createWrapper(),
  });
  let response;
  await act(async () => {
    response = await result.current.mutateAsync(createInput());
  });
  return response;
}
describe('useSavePerformanceTake', () => {
  it.each(['success', 'upload-error', 'finalize-error'] as const)(
    'holds media after Review clear until Save %s settles',
    async (outcome) => {
      const capture = recordingSinkFixture();
      await capture.sink.append(new Blob(['raw capture']));
      const media = await capture.sink.seal('audio/wav');
      const accepted = reservation();
      accepted.manifest.capture.byte_size = media.byteSize;
      vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
        data: accepted,
      } as never);
      vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
        data: {
          ...savedTake,
          manifest: accepted.manifest,
          recording_media: {
            mime_type: accepted.manifest.capture.mime_type,
            byte_size: accepted.manifest.capture.byte_size,
          },
        },
      } as never);
      let finish!: () => void, fail!: (error: Error) => void;
      vi.mocked(uploadMediaToSignedUrl).mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      );
      if (outcome === 'finalize-error')
        vi.mocked(performanceTakesApi.finalizeTake).mockRejectedValueOnce(
          new Error('finalize failed'),
        );
      const { result } = renderHook(() => useSavePerformanceTake(), {
        wrapper: createWrapper(),
      });
      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current.mutateAsync(
          createInput({ recording: { media }, executed: {} }),
        );
      });
      await media.release();
      expect(capture.exists()).toBe(true);
      await vi.waitFor(() => expect(uploadMediaToSignedUrl).toHaveBeenCalled());
      await act(async () => {
        if (outcome === 'upload-error') fail(new Error('upload failed'));
        else finish();
        if (outcome === 'success') await pending;
        else await expect(pending).rejects.toThrow('failed');
      });
      expect(capture.exists()).toBe(false);
      expect(capture.remove).toHaveBeenCalledOnce();
    },
  );
  it('sends metadata once to reserve, uploads to the target, and finalizes only its public identity', async () => {
    expect(await save()).toEqual(savedTake);
    expect(performanceTakesApi.reserveUpload).toHaveBeenCalledExactlyOnceWith({
      client_request_id: 'request-1',
      practice_binding: {
        score_id: 'score-1',
        revision_id: 'revision-1',
        bundle_id: 'source-1',
      },
      media: savedTake.manifest.capture,
      scope: { kind: 'FULL' },
      tempo_selection: tempoPlan.selection,
      recording_timebase: recordingTimebase,
    });
    expect(uploadMediaToSignedUrl).toHaveBeenCalledExactlyOnceWith(
      'https://objects.example/staging.wav',
      'PUT',
      { 'content-type': 'audio/wav' },
      createInput().recordedPerformance.recording.media.blob,
    );
    expect(performanceTakesApi.finalizeTake).toHaveBeenCalledExactlyOnceWith(
      'upload-reservation-1',
    );
    expect(performanceTakesApi.cancelUploadReservation).not.toHaveBeenCalled();
  });
  it('saves exact original MP4 recording bytes directly while normalizing only the request MIME', async () => {
    const raw = new Blob(['raw captured mp4'], {
      type: 'video/mp4;codecs=avc1',
    });
    const input = createInput({
      recording: {
        kind: 'VIDEO' as const,
        mimeType: raw.type,
        media: localMediaAssetFixture(raw),
      },
      executed: {},
    });
    const reserved = reservation();
    reserved.manifest.capture = {
      kind: 'VIDEO',
      byte_size: raw.size,
      mime_type: 'video/mp4',
    };
    reserved.upload_target = {
      url: 'https://objects.example/staging.mp4',
      method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
      expires_in: 3600,
    };
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
      data: reserved,
    } as never);
    vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
      data: {
        ...savedTake,
        recording_media: { mime_type: 'video/mp4', byte_size: raw.size },
        manifest: {
          ...savedTake.manifest,
          capture: {
            ...savedTake.manifest.capture,
            kind: 'VIDEO',
            mime_type: 'video/mp4',
            byte_size: raw.size,
          },
        },
      },
    } as never);
    const { result } = renderHook(() => useSavePerformanceTake(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(performanceTakesApi.reserveUpload).toHaveBeenCalledWith(
      expect.objectContaining({ media: reserved.manifest.capture }),
    );
    expect(vi.mocked(uploadMediaToSignedUrl).mock.calls[0][3]).toBe(raw);
    expect(uploadMediaToSignedUrl).toHaveBeenCalledWith(
      'https://objects.example/staging.mp4',
      'PUT',
      { 'content-type': 'video/mp4' },
      raw,
    );
  });
  it('returns COMPLETED without another upload or finalize', async () => {
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
      data: reservation('COMPLETED'),
    } as never);
    expect(await save()).toEqual(savedTake);
    expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
    expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
  });
  it('retries FINALIZING by identity without uploading', async () => {
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
      data: reservation('FINALIZING'),
    } as never);
    expect(await save()).toEqual(savedTake);
    expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
    expect(performanceTakesApi.finalizeTake).toHaveBeenCalledExactlyOnceWith(
      'upload-reservation-1',
    );
  });
  it('cancels the public reservation after a failed binary upload', async () => {
    vi.mocked(uploadMediaToSignedUrl).mockRejectedValue(
      new Error('upload failed'),
    );
    await expect(save()).rejects.toThrow('upload failed');
    expect(
      performanceTakesApi.cancelUploadReservation,
    ).toHaveBeenCalledExactlyOnceWith('upload-reservation-1');
    expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
  });
  it.each([new Error('network lost'), { response: { status: 422 } }])(
    'retains reservation on unknown/recoverable finalize outcome',
    async (error) => {
      vi.mocked(performanceTakesApi.finalizeTake).mockRejectedValue(error);
      await expect(save()).rejects.toBe(error);
      expect(uploadMediaToSignedUrl).toHaveBeenCalledOnce();
      expect(
        performanceTakesApi.cancelUploadReservation,
      ).not.toHaveBeenCalled();
    },
  );
  it('reserves RANGE VIDEO metadata once', async () => {
    const input = createInput({
      recording: {
        kind: 'VIDEO' as const,
        mimeType: 'video/webm',
        media: localMediaAssetFixture(
          new Blob(['RIFF....WAVE'], { type: 'video/webm' }),
        ),
      },
      executed: {
        scope: {
          startIndex: 0,
          endIndex: 0,
          ...{
            kind: 'RANGE' as const,
            startTick: 1,
            terminalTick: 3,
            startGroupId: 'g1',
            endGroupId: 'g3',
          },
        },
      },
    });
    const accepted = reservation();
    accepted.manifest.capture.kind = input.recordedPerformance.recording.kind;
    accepted.manifest.capture.mime_type = 'video/webm';
    accepted.manifest.scope = {
      kind: 'RANGE',
      start_tick: 1,
      terminal_tick: 3,
      start_group_id: 'g1',
      end_group_id: 'g3',
    };
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
      data: accepted,
    } as never);
    vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
      data: {
        ...savedTake,
        recording_media: {
          ...savedTake.recording_media,
          mime_type: 'video/webm',
        },
        manifest: {
          ...savedTake.manifest,
          capture: {
            ...savedTake.manifest.capture,
            kind: 'VIDEO',
            mime_type: 'video/webm',
          },
          scope: {
            ...savedTake.manifest.scope,
            kind: 'RANGE',
            start_tick: 1,
            terminal_tick: 3,
            start_group_id: 'g1',
            end_group_id: 'g3',
          },
        },
      },
    } as never);
    const { result } = renderHook(() => useSavePerformanceTake(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(performanceTakesApi.reserveUpload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        media: expect.objectContaining({ kind: 'VIDEO' }),
        scope: { kind: 'RANGE', start_group_id: 'g1', end_group_id: 'g3' },
      }),
    );
    expect(performanceTakesApi.finalizeTake).toHaveBeenCalledExactlyOnceWith(
      'upload-reservation-1',
    );
  });
});
describe('server canonical plan agreement before media upload', () => {
  const differences: [
    string,
    (value: PerformanceTakeUploadReservationRead) => void,
  ][] = [
    [
      'score timebase',
      (value) => {
        value.manifest.score_timebase.ticks_per_quarter = 60;
      },
    ],
    [
      'missing score timebase',
      (value) => {
        Reflect.deleteProperty(value.manifest, 'score_timebase');
      },
    ],
    [
      'unsafe score timebase',
      (value) => {
        value.manifest.score_timebase.ticks_per_quarter =
          Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'source',
      (value) => {
        value.manifest.practice_binding.bundle_id = 'different-source';
      },
    ],
    [
      'scope start',
      (value) => {
        value.manifest.scope.start_tick = 1;
      },
    ],
    [
      'scope terminal',
      (value) => {
        value.manifest.scope.terminal_tick = 5;
      },
    ],
    [
      'scope selection',
      (value) => {
        value.manifest.scope = {
          kind: 'RANGE',
          start_tick: 0,
          terminal_tick: 4,
          start_group_id: 'a',
          end_group_id: 'b',
        };
      },
    ],
    [
      'tempo selection',
      (value) => {
        value.manifest.tempo_plan.selection = {
          mode: 'CUSTOM_FIXED_BPM',
          bpm: 120,
        };
      },
    ],
    [
      'tempo bpm',
      (value) => {
        value.manifest.tempo_plan.segments[0].bpm = 121;
      },
    ],
    [
      'tempo position',
      (value) => {
        value.manifest.tempo_plan.segments[0].startTick = 1;
      },
    ],
    [
      'tempo source',
      (value) => {
        value.manifest.tempo_plan.segments[0].source = 'PRODUCT_DEFAULT';
      },
    ],
    [
      'tempo segments',
      (value) => {
        value.manifest.tempo_plan.segments.push({
          startTick: 2,
          bpm: 120,
          source: 'MUSICXML',
        });
      },
    ],
  ];
  it.each(differences)(
    'cancels RESERVED on mismatched %s, without upload or finalize',
    async (_, change) => {
      const accepted = structuredClone(reservation());
      change(accepted);
      vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
        data: accepted,
      } as never);
      await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
      expect(
        performanceTakesApi.cancelUploadReservation,
      ).toHaveBeenCalledExactlyOnceWith(accepted.reservation_id);
      expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
      expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
    },
  );
  it('fails deterministically even when mismatch cancellation is unavailable', async () => {
    const accepted = structuredClone(reservation());
    accepted.manifest.scope.terminal_tick = 5;
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
      data: accepted,
    } as never);
    vi.mocked(performanceTakesApi.cancelUploadReservation).mockRejectedValue(
      new Error('offline'),
    );
    await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
    expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
  });
  it('does not finalize or cancel a mismatched FINALIZING reservation', async () => {
    const accepted = structuredClone(reservation('FINALIZING'));
    accepted.manifest.scope.terminal_tick = 5;
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
      data: accepted,
    } as never);
    await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
    expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
    expect(performanceTakesApi.cancelUploadReservation).not.toHaveBeenCalled();
  });
  it.each(['source', 'scope', 'tempo', 'timebase'] as const)(
    'rejects COMPLETED Take with mismatched %s',
    async (field) => {
      const accepted = structuredClone(reservation('COMPLETED'));
      if (field === 'timebase')
        accepted.take!.manifest.score_timebase.ticks_per_quarter = 60;
      if (field === 'source')
        accepted.take!.manifest.practice_binding.bundle_id = 'different-source';
      if (field === 'scope') accepted.take!.manifest.scope.terminal_tick = 5;
      if (field === 'tempo')
        accepted.take!.manifest.tempo_plan.segments[0].bpm = 121;
      vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
        data: accepted,
      } as never);
      await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
      expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
      expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
    },
  );
  it('checks freshly finalized Take truth before reporting saved success', async () => {
    vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
      data: {
        ...savedTake,
        manifest: {
          ...savedTake.manifest,
          scope: {
            ...savedTake.manifest.scope,
            terminal_tick: 5,
          },
        },
      },
    } as never);
    await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
  });
});
it('requires exact fractional custom selection agreement', async () => {
  const input = createInput({
    recording: {},
    executed: {
      tempoPlan: {
        selection: { mode: 'CUSTOM_FIXED_BPM' as const, bpm: 80.5 },
        segments: [{ startTick: 0, bpm: 80.5, source: 'CUSTOM' as const }],
      },
    },
  });
  const accepted = structuredClone(reservation());
  accepted.manifest.tempo_plan = {
    selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 80.6 },
    segments: [{ startTick: 0, bpm: 80.5, source: 'CUSTOM' }],
  };
  vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
    data: accepted,
  } as never);
  const { result } = renderHook(() => useSavePerformanceTake(), {
    wrapper: createWrapper(),
  });
  await act(async () => {
    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'PERFORMANCE_TAKE_PLAN_MISMATCH',
    );
  });
  expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
});
it('requires exact RANGE group identities even when beats match', async () => {
  const input = createInput({
    recording: {},
    executed: {
      scope: {
        startIndex: 0,
        endIndex: 0,
        ...{
          kind: 'RANGE' as const,
          startTick: 0,
          terminalTick: 4,
          startGroupId: 'a',
          endGroupId: 'b',
        },
      },
    },
  });
  const accepted = structuredClone(reservation());
  accepted.manifest.scope = {
    kind: 'RANGE',
    start_tick: 0,
    terminal_tick: 4,
    start_group_id: 'a',
    end_group_id: 'c',
  };
  vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
    data: accepted,
  } as never);
  const { result } = renderHook(() => useSavePerformanceTake(), {
    wrapper: createWrapper(),
  });
  await act(async () => {
    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'PERFORMANCE_TAKE_PLAN_MISMATCH',
    );
  });
  expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
});
it('validates the executed grid locally without submitting it as reservation authority', async () => {
  const input = createInput();
  input.recordedPerformance = {
    ...input.recordedPerformance,
    executed: {
      ...input.recordedPerformance.executed,
      bundle: {
        ...input.recordedPerformance.executed.bundle,
        artifact: {
          ...input.recordedPerformance.executed.bundle.artifact,
          ticksPerQuarter: 60,
        },
      },
    },
  };
  const accepted = structuredClone(reservation());
  accepted.manifest.score_timebase.ticks_per_quarter = 60;
  vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
    data: accepted,
  } as never);
  vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
    data: {
      ...savedTake,
      manifest: {
        ...savedTake.manifest,
        score_timebase: { ticks_per_quarter: 60 },
      },
    },
  } as never);
  const { result } = renderHook(() => useSavePerformanceTake(), {
    wrapper: createWrapper(),
  });
  await act(async () => {
    await result.current.mutateAsync(input);
  });
  const request = vi.mocked(performanceTakesApi.reserveUpload).mock.calls[0][0];
  expect(request).not.toHaveProperty('score_timebase');
  expect(request).not.toHaveProperty('ticks_per_quarter');
  expect(request).not.toHaveProperty('ticksPerQuarter');
});
it('rejects a finalized Take on a different grid even when its tick values match', async () => {
  vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
    data: {
      ...savedTake,
      manifest: {
        ...savedTake.manifest,
        score_timebase: { ticks_per_quarter: 60 },
      },
    },
  } as never);
  await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
});

it.each(['RESERVED', 'COMPLETED'] as const)(
  'uses common Manifest media/evidence agreement for %s',
  async (status) => {
    for (const change of [
      (manifest: PerformanceTakeRead['manifest']) => {
        manifest.capture.byte_size += 1;
      },
      (manifest: PerformanceTakeRead['manifest']) => {
        manifest.capture.mime_type = 'audio/webm';
      },
      (manifest: PerformanceTakeRead['manifest']) => {
        manifest.recording_timebase.nominalMediaDurationUs += 1;
      },
    ]) {
      const accepted = structuredClone(reservation(status));
      change(
        status === 'COMPLETED' ? accepted.take!.manifest : accepted.manifest,
      );
      vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({
        data: accepted,
      } as never);
      await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
    }
  },
);

it.each(['mime_type', 'byte_size'] as const)(
  'rejects saved recording %s inconsistent with admitted Capture',
  async (field) => {
    const invalid = structuredClone(savedTake);
    if (field === 'mime_type') invalid.recording_media.mime_type = 'audio/webm';
    else invalid.recording_media.byte_size++;
    vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({
      data: invalid,
    } as never);
    await expect(save()).rejects.toThrow('PERFORMANCE_TAKE_PLAN_MISMATCH');
  },
);

describe('semantic Take deletion cache admission', () => {
  it('removes the resource and corrects paginated totals before background list refresh completes', async () => {
    const { queryKeys } = await import('@/lib/query-client');
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const first = queryKeys.performanceTakes.list({ limit: 1, offset: 0 });
    const second = queryKeys.performanceTakes.list({ limit: 1, offset: 1 });
    const matching = queryKeys.performanceTakes.list({ score_id: 'score-1' });
    const unrelated = queryKeys.performanceTakes.list({ score_id: 'score-2' });
    const other = { ...savedTake, take_id: 'other' };
    const list = (items: PerformanceTakeRead[], total: number, offset = 0) => ({
      data: {
        items,
        total,
        limit: 1,
        offset,
        has_more: offset + items.length < total,
      },
    });
    client.setQueryData(first, list([savedTake], 2));
    client.setQueryData(second, list([other], 2, 1));
    client.setQueryData(matching, list([savedTake], 1));
    client.setQueryData(unrelated, list([other], 1));
    client.setQueryData(queryKeys.performanceTakes.detail('take-1'), {
      data: savedTake,
    });
    client.setQueryData(queryKeys.performanceTakes.playbackUrl('take-1'), {
      data: { playback_url: 'signed-deleted' },
    });
    client.setQueryData(queryKeys.performanceTakes.playbackUrl('other'), {
      data: { playback_url: 'signed-other' },
    });
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockImplementation(() => new Promise(() => {}));
    vi.mocked(performanceTakesApi.deleteTake).mockResolvedValue({
      data: { take_id: 'take-1', deleted: true },
    } as never);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useDeletePerformanceTake(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync('take-1');
    });
    expect(client.getQueryData(first)).toMatchObject({
      data: { items: [], total: 1, has_more: true },
    });
    expect(client.getQueryData(second)).toMatchObject({
      data: { items: [other], total: 1, has_more: false },
    });
    expect(client.getQueryData(matching)).toMatchObject({
      data: { items: [], total: 0 },
    });
    expect(client.getQueryData(unrelated)).toMatchObject({
      data: { items: [other], total: 1 },
    });
    expect(
      client.getQueryData(queryKeys.performanceTakes.detail('take-1')),
    ).toBeUndefined();
    expect(
      client.getQueryData(queryKeys.performanceTakes.playbackUrl('take-1')),
    ).toBeUndefined();
    expect(
      client.getQueryData(queryKeys.performanceTakes.playbackUrl('other')),
    ).toMatchObject({ data: { playback_url: 'signed-other' } });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.storageUsage.all,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.performanceTakes.lists(),
    });
    hook.unmount();
    client.clear();
  });

  it('keeps cached semantic authority when DELETE is rejected', async () => {
    const { queryKeys } = await import('@/lib/query-client');
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const key = queryKeys.performanceTakes.list();
    const cached = { data: { items: [savedTake], total: 1 } };
    client.setQueryData(key, cached);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(performanceTakesApi.deleteTake).mockRejectedValue(
      new Error('denied'),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useDeletePerformanceTake(), { wrapper });
    await act(async () => {
      await expect(hook.result.current.mutateAsync('take-1')).rejects.toThrow(
        'denied',
      );
    });
    expect(client.getQueryData(key)).toEqual(cached);
    expect(invalidate).not.toHaveBeenCalled();
    hook.unmount();
    client.clear();
  });
});

it('cancels stale deleted-resource/list reads while another Take playback remains live', async () => {
  const { queryKeys } = await import('@/lib/query-client');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const key = queryKeys.performanceTakes.list();
  client.setQueryData(key, {
    data: { items: [savedTake], total: 1, offset: 0 },
  });
  let listSignal!: AbortSignal, otherSignal!: AbortSignal;
  let finishList!: (data: unknown) => void,
    finishOther!: (data: unknown) => void;
  const stale = client
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        listSignal = signal;
        return new Promise((resolve) => {
          finishList = resolve;
        });
      },
    })
    .catch(() => undefined);
  const other = client.fetchQuery({
    queryKey: queryKeys.performanceTakes.playbackUrl('other'),
    queryFn: ({ signal }) => {
      otherSignal = signal;
      return new Promise((resolve) => {
        finishOther = resolve;
      });
    },
  });
  vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  vi.mocked(performanceTakesApi.deleteTake).mockResolvedValue({
    data: { take_id: 'take-1', deleted: true },
  } as never);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDeletePerformanceTake(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync('take-1');
  });
  expect(listSignal.aborted).toBe(true);
  expect(otherSignal.aborted).toBe(false);
  finishList({ data: { items: [savedTake], total: 1 } });
  finishOther({ data: { playback_url: 'other-signed-recording' } });
  await stale;
  await other;
  expect(client.getQueryData(key)).toMatchObject({
    data: { items: [], total: 0 },
  });
  expect(
    client.getQueryData(queryKeys.performanceTakes.playbackUrl('other')),
  ).toMatchObject({ data: { playback_url: 'other-signed-recording' } });
  hook.unmount();
  client.clear();
});
