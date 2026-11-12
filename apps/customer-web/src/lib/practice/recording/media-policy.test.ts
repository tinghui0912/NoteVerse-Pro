import { expect, it } from 'vitest';
import {
  captureMediaExtension,
  isSupportedCaptureMime,
  normalizeCaptureMime,
} from './media-policy';

import {
  CAPTURE_CONTAINERS,
  VIDEO_CAPTURE_MIME_CANDIDATES,
} from './generated/media-policy';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

it.each(CAPTURE_CONTAINERS)(
  'admits $kind $mimeType with its raw extension',
  ({ kind, mimeType: mime, extension }) => {
    const browserMime = ` ${mime.toUpperCase()} ;codecs=browser-selected`;
    expect(isSupportedCaptureMime(kind, browserMime)).toBe(true);
    expect(normalizeCaptureMime(browserMime)).toBe(mime);
    expect(captureMediaExtension(browserMime)).toBe(extension);
  },
);

it.each([
  ['VIDEO', 'audio/mp4'],
  ['AUDIO', 'video/mp4'],
  ['VIDEO', 'video/quicktime'],
  ['AUDIO', 'audio/unknown'],
  ['AUDIO', ''],
] as const)('rejects %s container %s', (kind, mime) => {
  expect(isSupportedCaptureMime(kind, mime)).toBe(false);
});

it('keeps x-wav identity and rejects unknown extension without a format fallback', () => {
  expect(normalizeCaptureMime(' VIDEO/MP4 ;codecs=avc1')).toBe('video/mp4');
  expect(normalizeCaptureMime('audio/x-wav;codecs=browser')).toBe(
    'audio/x-wav',
  );
  expect(captureMediaExtension('audio/x-wav')).toBe('wav');
  expect(() => captureMediaExtension('audio/unknown')).toThrow(
    'Unsupported capture container',
  );
  expect(() => captureMediaExtension('')).toThrow(
    'Unsupported capture container',
  );
});

it('consumes immutable generated descriptors and preserves canonical VIDEO order', () => {
  const policy = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../../contracts/practice/recording-media-policy.json',
      ),
      'utf8',
    ),
  );
  expect(CAPTURE_CONTAINERS).toEqual(policy.captureContainers);
  expect(VIDEO_CAPTURE_MIME_CANDIDATES).toEqual(policy.videoRecorderCandidates);
  expect(Object.isFrozen(CAPTURE_CONTAINERS)).toBe(true);
  expect(CAPTURE_CONTAINERS.every(Object.isFrozen)).toBe(true);
  expect(Object.isFrozen(VIDEO_CAPTURE_MIME_CANDIDATES)).toBe(true);
});

it('keeps the Recording adapter over generated data', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/lib/practice/recording/media-policy.ts'),
    'utf8',
  );
  const ast = ts.createSourceFile(
    'media-policy.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  expect(
    ast.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === './generated/media-policy',
    ),
  ).toBe(true);
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node))
      expect(/^(audio|video)\//.test(node.text)).toBe(false);
    ts.forEachChild(node, visit);
  };
  visit(ast);
});
