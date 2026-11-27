import { expect, it } from 'vitest';
import {
  recordingMediaExtension,
  isAdmittedRecordingMime,
  normalizeRecordingMime,
} from './media-admission';

import {
  ORIGINAL_RECORDING_CONTAINERS,
} from './generated/media-admission';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

it.each(ORIGINAL_RECORDING_CONTAINERS)(
  'admits $kind $mimeType with its raw extension',
  ({ kind, mimeType: mime, extension }) => {
    const browserMime = ` ${mime.toUpperCase()} ;codecs=browser-selected`;
    expect(isAdmittedRecordingMime(kind, browserMime)).toBe(true);
    expect(normalizeRecordingMime(browserMime)).toBe(mime);
    expect(recordingMediaExtension(browserMime)).toBe(extension);
  },
);

it.each([
  ['VIDEO', 'audio/mp4'],
  ['AUDIO', 'video/mp4'],
  ['VIDEO', 'video/quicktime'],
  ['AUDIO', 'audio/unknown'],
  ['AUDIO', ''],
] as const)('rejects %s container %s', (kind, mime) => {
  expect(isAdmittedRecordingMime(kind, mime)).toBe(false);
});

it('keeps x-wav identity and rejects unknown extension without a format fallback', () => {
  expect(normalizeRecordingMime(' VIDEO/MP4 ;codecs=avc1')).toBe('video/mp4');
  expect(normalizeRecordingMime('audio/x-wav;codecs=browser')).toBe(
    'audio/x-wav',
  );
  expect(recordingMediaExtension('audio/x-wav')).toBe('wav');
  expect(() => recordingMediaExtension('audio/unknown')).toThrow(
    'Unsupported original recording container',
  );
  expect(() => recordingMediaExtension('')).toThrow(
    'Unsupported original recording container',
  );
});

it('consumes immutable durable admission descriptors', () => {
  const admission = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../../contracts/practice/recording-media-admission.json',
      ),
      'utf8',
    ),
  );
  expect(ORIGINAL_RECORDING_CONTAINERS).toEqual(admission.originalRecordingContainers);
  expect(Object.isFrozen(ORIGINAL_RECORDING_CONTAINERS)).toBe(true);
  expect(ORIGINAL_RECORDING_CONTAINERS.every(Object.isFrozen)).toBe(true);
});

it('keeps the Recording adapter over generated data', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/lib/practice/recording/media-admission.ts'),
    'utf8',
  );
  const ast = ts.createSourceFile(
    'media-admission.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  expect(
    ast.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === './generated/media-admission',
    ),
  ).toBe(true);
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node))
      expect(/^(audio|video)\//.test(node.text)).toBe(false);
    ts.forEachChild(node, visit);
  };
  visit(ast);
});
