// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { initialShareVideoOrientation } from './share-video-studio';

describe('initialShareVideoOrientation', () => {
  it('defaults to landscape until media dimensions are available', () => {
    expect(initialShareVideoOrientation(null)).toBe('landscape');
    expect(initialShareVideoOrientation({ videoWidth: 0, videoHeight: 0 })).toBe('landscape');
  });

  it('selects landscape for a horizontal recording', () => {
    expect(initialShareVideoOrientation({ videoWidth: 1920, videoHeight: 1080 })).toBe(
      'landscape'
    );
  });

  it('selects portrait for a vertical recording', () => {
    expect(initialShareVideoOrientation({ videoWidth: 1080, videoHeight: 1920 })).toBe(
      'portrait'
    );
  });
});
