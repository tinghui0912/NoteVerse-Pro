import { expect, it } from 'vitest';
import {
  artifact,
  take,
} from '@/lib/practice/video-export/__fixtures__/saved-take';
import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';
import { admitSavedRecordedPerformance } from './saved-performance';
import {
  archivedTakeAgreesWithRecordedPerformance,
  performanceTakeUploadRequest,
  takeManifestAgreesWithRecordedPerformance,
} from './take-admission';

const admitted = admitSavedRecordedPerformance(
  take,
  {
    binding: {
      scoreId: 'score-1',
      revisionId: 'revision-1',
      bundleId: take.manifest.practice_binding.bundle_id,
    },
    artifact,
  },
  localMediaAssetFixture(new Blob(['1234567890'], { type: 'video/webm' })),
);
if (admitted.status !== 'supported') throw new Error(admitted.reason);
const performance = admitted.recordedPerformance;

it('projects a reservation solely from the recorded execution and request identity', () => {
  const request = performanceTakeUploadRequest({
    clientRequestId: 'request-sentinel',
    recordedPerformance: performance,
  });
  expect(request).toEqual({
    client_request_id: 'request-sentinel',
    practice_binding: take.manifest.practice_binding,
    media: take.manifest.capture,
    scope: { kind: 'FULL' },
    tempo_selection: take.manifest.tempo_plan.selection,
    recording_timebase: take.manifest.recording_timebase,
  });
  expect(
    takeManifestAgreesWithRecordedPerformance(take.manifest, performance),
  ).toBe(true);
  expect(archivedTakeAgreesWithRecordedPerformance(take, performance)).toBe(
    true,
  );
});

const corruptions: [string, (value: typeof take) => void][] = [
  [
    'bundle',
    (v) => {
      v.manifest.practice_binding.bundle_id = 'different';
    },
  ],
  [
    'score',
    (v) => {
      v.manifest.practice_binding.score_id = 'different';
    },
  ],
  [
    'revision',
    (v) => {
      v.manifest.practice_binding.revision_id = 'different';
    },
  ],
  [
    'artifact',
    (v) => {
      v.manifest.artifact_id = 'different';
    },
  ],
  [
    'TPQ',
    (v) => {
      v.manifest.score_timebase.ticks_per_quarter++;
    },
  ],
  [
    'scope start',
    (v) => {
      v.manifest.scope.start_tick++;
    },
  ],
  [
    'scope terminal',
    (v) => {
      v.manifest.scope.terminal_tick--;
    },
  ],
  [
    'scope selection',
    (v) => {
      v.manifest.scope = {
        kind: 'RANGE',
        start_tick: 0,
        terminal_tick: 16,
        start_group_id: 'group-1',
        end_group_id: 'group-2',
      };
    },
  ],
  [
    'tempo',
    (v) => {
      v.manifest.tempo_plan.segments[0].bpm++;
    },
  ],
  [
    'tempo selection',
    (v) => {
      v.manifest.tempo_plan.selection = { mode: 'CUSTOM_FIXED_BPM', bpm: 96 };
    },
  ],
  [
    'recording timebase',
    (v) => {
      v.manifest.recording_timebase.activeSegments[0].performanceStartUs++;
    },
  ],
  [
    'capture kind',
    (v) => {
      v.manifest.capture.kind = 'AUDIO';
    },
  ],
  [
    'capture MIME',
    (v) => {
      v.manifest.capture.mime_type = 'video/mp4';
    },
  ],
  [
    'capture bytes',
    (v) => {
      v.manifest.capture.byte_size++;
    },
  ],
];
it.each(corruptions)(
  'rejects server Manifest %s disagreement',
  (_, corrupt) => {
    const value = structuredClone(take);
    corrupt(value);
    expect(
      takeManifestAgreesWithRecordedPerformance(value.manifest, performance),
    ).toBe(false);
    expect(archivedTakeAgreesWithRecordedPerformance(value, performance)).toBe(
      false,
    );
  },
);
it.each(['mime_type', 'byte_size'] as const)(
  'rejects finalized archive %s disagreement',
  (field) => {
    const value = structuredClone(take);
    if (field === 'mime_type') value.archive_media.mime_type = 'video/mp4';
    else value.archive_media.byte_size++;
    expect(archivedTakeAgreesWithRecordedPerformance(value, performance)).toBe(
      false,
    );
  },
);

it('checks both RANGE group identities independently', () => {
  const ranged = {
    ...performance,
    executed: {
      ...performance.executed,
      scope: {
        kind: 'RANGE' as const,
        startIndex: 0,
        endIndex: 1,
        startTick: 0,
        terminalTick: 16,
        startGroupId: 'group-1',
        endGroupId: 'group-2',
      },
    },
  };
  for (const field of ['start_group_id', 'end_group_id'] as const) {
    const value = structuredClone(take);
    value.manifest.scope = {
      kind: 'RANGE',
      start_tick: 0,
      terminal_tick: 16,
      start_group_id: 'group-1',
      end_group_id: 'group-2',
    };
    expect(
      takeManifestAgreesWithRecordedPerformance(value.manifest, ranged),
    ).toBe(true);
    value.manifest.scope[field] = 'different';
    expect(
      takeManifestAgreesWithRecordedPerformance(value.manifest, ranged),
    ).toBe(false);
  }
});
