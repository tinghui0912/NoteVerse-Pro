import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { admitPracticeBundle } from './admit-practice-bundle';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeBundle: request } }));
const representation = () => ({
    binding: {
      score_id: 'score-1',
      revision_id: 'revision-1',
      bundle_id: 'bundle',
    },
    artifact: structuredClone(fixture),
    notation: {
      musicxml: '<score />',
      mime_type: 'application/vnd.recordare.musicxml+xml',
    },
  });
const load = (signal = new AbortController().signal) =>
  admitPracticeBundle('score-1', 'revision-1', signal);
beforeEach(() => {
  request.mockReset().mockImplementation(async () => representation());
});
it('fresh complete admission owns the exact returned references independently of cache', async () => {
  const response = representation(),
    signal = new AbortController().signal;
  request.mockResolvedValue(response);
  const source = await load(signal);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    'score-1',
    'revision-1',
    true,
    signal,
  );
  expect(source).toEqual({
    binding: {
      scoreId: 'score-1',
      revisionId: 'revision-1',
      bundleId: 'bundle',
    },
    artifact: response.artifact,
    musicXml: '<score />',
  });
  expect(source.artifact).toBe(response.artifact);
  expect(Object.isFrozen(source.artifact)).toBe(true);
  expect(Object.isFrozen(source.artifact.notes[0])).toBe(true);
  expect(Object.isFrozen(source.artifact.moments)).toBe(true);
  request.mockResolvedValueOnce({
      ...representation(),
      binding: { ...representation().binding, bundle_id: 'next' },
    });
  expect((await load()).binding.bundleId).toBe('next');
  expect(source.binding.bundleId).toBe('bundle');
  expect(request).toHaveBeenCalledTimes(2);
});
it.each(['score_id', 'revision_id'] as const)(
  'rejects a mismatched %s',
  async (field) => {
    const response = representation();
    response.binding[field] = 'wrong';
    request.mockResolvedValue(response);
    await expect(load()).rejects.toMatchObject({
      kind: 'BUNDLE',
      code: 'INVALID_SCORE',
    });
  },
);
it.each([undefined, '', 1])(
  'requires Bundle binding identity: %s',
  async (bundle_id) => {
    request.mockResolvedValue({
        ...representation(),
        binding: { ...representation().binding, bundle_id },
      });
    await expect(load()).rejects.toMatchObject({
      kind: 'BUNDLE',
      code: 'INVALID_SCORE',
    });
  },
);
it.each([
  null,
  { musicxml: '' },
  { musicxml: '   ', mime_type: 'application/vnd.recordare.musicxml+xml' },
  { musicxml: '<score />', mime_type: 'text/plain' },
])('requires complete notation: %j', async (notation) => {
  request.mockResolvedValue({ ...representation(), notation });
  await expect(load()).rejects.toMatchObject({
    kind: 'BUNDLE',
    code: 'INVALID_SCORE',
  });
});
it('strict artifact admission rejects empty required notation structure', async () => {
  request.mockResolvedValue({ ...representation(), artifact: { ...fixture, notes: [] } });
  await expect(load()).rejects.toMatchObject({
    kind: 'BUNDLE',
    code: 'INVALID_SCORE',
  });
});
it('keeps transport/service failures distinct from deterministic invalid Bundle', async () => {
  const cause = new Error('transport');
  request.mockRejectedValue(cause);
  await expect(load()).rejects.toMatchObject({
    kind: 'BUNDLE',
    code: 'LOAD_FAILED',
    cause,
  });
  request.mockRejectedValue({ code: 'practice_score_invalid' });
  await expect(load()).rejects.toMatchObject({
    kind: 'BUNDLE',
    code: 'INVALID_SCORE',
  });
});
it('caller cancellation reaches the actual transport and a late response cannot admit', async () => {
  let resolve!: (value: ReturnType<typeof representation>) => void;
  request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const command = new AbortController(),
    pending = load(command.signal).catch((error) => error);
  expect(request.mock.calls[0][3]).toBe(command.signal);
  command.abort();
  expect(request.mock.calls[0][3].aborted).toBe(true);
  resolve(representation());
  expect(await pending).toBe(command.signal.reason);
  const next = new AbortController();
  request.mockResolvedValue(representation());
  await load(next.signal);
  expect(request.mock.calls[1][3]).toBe(next.signal);
  expect(next.signal.aborted).toBe(false);
});
it('an already-aborted command starts no request', async () => {
  const command = new AbortController();
  command.abort();
  await expect(load(command.signal)).rejects.toBe(command.signal.reason);
  expect(request).not.toHaveBeenCalled();
});
