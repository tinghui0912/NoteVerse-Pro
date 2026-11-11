import { expect, it } from 'vitest';
import { admitSavedRecordedPerformance } from './saved-performance';
import {
  artifact,
  take,
} from "@/lib/practice/composite-video/__fixtures__/saved-take";
import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';
import { recordingPlaybackSource } from '@/lib/practice/recording/recording-playback';
const bundle = {
  binding: {
    scoreId: 'score-1',
    revisionId: 'revision-1',
    bundleId: take.manifest.practice_binding.bundle_id,
  },
  artifact,
};
function media(size = 10) {
  return localMediaAssetFixture(
    new Blob(['x'.repeat(size)], { type: 'video/webm' }),
  );
}
it('admits exactly one recording with canonical artifact and durable scope/tempo/timebase', () => {
  const handle = media(),
    result = admitSavedRecordedPerformance(take, bundle, handle);
  expect(result.status).toBe('supported');
  if (result.status !== 'supported') throw new Error(result.reason);
  const p = result.recordedPerformance;
  expect(p.executed.bundle.binding).toBe(bundle.binding);
  expect(Object.isFrozen(p.executed.bundle)).toBe(true);
  expect(Object.isFrozen(p.executed.tempoPlan.selection)).toBe(true);
  expect(p.executed.bundle.artifact).toBe(artifact);
  expect(p.executed.scope).toMatchObject({
    kind: 'FULL',
    startTick: take.manifest.scope.start_tick,
    terminalTick: take.manifest.scope.terminal_tick,
  });
  expect(p.executed.tempoPlan).toEqual(take.manifest.tempo_plan);
  expect(p.recording.timebase).toEqual(take.manifest.recording_timebase);
  expect(recordingPlaybackSource(p.recording)?.recordingTimebase).toBe(
    p.recording.timebase,
  );
  expect(recordingPlaybackSource(p.recording)?.media).toBe(handle);
});
it('validates range identity and ticks before admitting the persisted selection', () => {
  const value = structuredClone(take);
  value.manifest.scope = {
    kind: 'RANGE',
    start_group_id: 'group-2',
    end_group_id: 'group-2',
    start_tick: 4,
    terminal_tick: 16,
  };
  const result = admitSavedRecordedPerformance(value, bundle, media());
  expect(result.status).toBe('supported');
  if (result.status === 'supported')
    expect(result.recordedPerformance.executed.scope).toMatchObject({
      kind: 'RANGE',
      startGroupId: 'group-2',
      endGroupId: 'group-2',
      startTick: 4,
      terminalTick: 16,
    });
});
const corruptions: [string, (value: typeof take) => void][] = [
  [
    'deleting',
    (v) => {
      v.deletion_status = 'DELETING';
    },
  ],
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
      v.manifest.score_timebase.ticks_per_quarter = 60;
    },
  ],
  [
    'unsafe TPQ',
    (v) => {
      v.manifest.score_timebase.ticks_per_quarter = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'full start',
    (v) => {
      v.manifest.scope.start_tick = 1;
    },
  ],
  [
    'full terminal',
    (v) => {
      v.manifest.scope.terminal_tick = 15;
    },
  ],
  [
    'fractional tick',
    (v) => {
      v.manifest.scope.terminal_tick = 15.5;
    },
  ],
  [
    'range group',
    (v) => {
      v.manifest.scope = {
        kind: 'RANGE',
        start_group_id: 'absent',
        end_group_id: 'group-2',
        start_tick: 0,
        terminal_tick: 16,
      };
    },
  ],
  [
    'range tick',
    (v) => {
      v.manifest.scope = {
        kind: 'RANGE',
        start_group_id: 'group-2',
        end_group_id: 'group-2',
        start_tick: 3,
        terminal_tick: 16,
      };
    },
  ],
  [
    'tempo start',
    (v) => {
      v.manifest.tempo_plan.segments[0].startTick = 1;
    },
  ],
  [
    'tempo bpm',
    (v) => {
      v.manifest.tempo_plan.segments[0].bpm = Infinity;
    },
  ],
  [
    'scope fields',
    (v) => {
      Reflect.set(v.manifest.scope, 'extra', true);
    },
  ],
  [
    'custom tempo inconsistency',
    (v) => {
      v.manifest.tempo_plan.selection = { mode: 'CUSTOM_FIXED_BPM', bpm: 120 };
    },
  ],
  [
    'score custom source',
    (v) => {
      v.manifest.tempo_plan.segments[0].source = 'CUSTOM';
    },
  ],
  [
    'tempo empty',
    (v) => {
      v.manifest.tempo_plan.segments = [];
    },
  ],
  [
    'tempo selection',
    (v) => {
      Reflect.set(v.manifest.tempo_plan.selection, 'mode', 'OTHER');
    },
  ],
  [
    'tempo source',
    (v) => {
      Reflect.set(v.manifest.tempo_plan.segments[0], 'source', 'OTHER');
    },
  ],
  [
    'timebase empty',
    (v) => {
      v.manifest.recording_timebase.activeSegments = [];
    },
  ],
  [
    'timebase rate',
    (v) => {
      v.manifest.recording_timebase.activeSegments[0].performanceEndUs--;
    },
  ],
  [
    'timebase nominal',
    (v) => {
      v.manifest.recording_timebase.nominalMediaDurationUs--;
    },
  ],
  [
    'capture kind',
    (v) => {
      Reflect.set(v.manifest.capture, 'kind', 'OTHER');
    },
  ],
  [
    'capture MIME',
    (v) => {
      v.manifest.capture.mime_type = 'audio/wav';
    },
  ],
  [
    'archive MIME',
    (v) => {
      v.archive_media.mime_type = 'audio/wav';
    },
  ],
  [
    'capture size',
    (v) => {
      v.manifest.capture.byte_size++;
    },
  ],
  [
    'archive size',
    (v) => {
      v.archive_media.byte_size++;
    },
  ],
];
it.each(corruptions)('rejects %s without repair', (_, change) => {
  const value = structuredClone(take);
  change(value);
  const before = structuredClone(value);
  expect(admitSavedRecordedPerformance(value, bundle, media()).status).toBe(
    'unsupported',
  );
  expect(value).toEqual(before);
});
it('rejects local byte size mismatch', () => {
  expect(admitSavedRecordedPerformance(take, bundle, media(9)).status).toBe(
    'unsupported',
  );
});
