// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { initialVideoExportOrientation } from './video-export-studio';

describe('initialVideoExportOrientation', () => {
  it('defaults to landscape until media dimensions are available', () => {
    expect(initialVideoExportOrientation(null)).toBe('landscape');
    expect(initialVideoExportOrientation({ videoWidth: 0, videoHeight: 0 })).toBe('landscape');
  });

  it('selects landscape for a horizontal recording', () => {
    expect(initialVideoExportOrientation({ videoWidth: 1920, videoHeight: 1080 })).toBe(
      'landscape'
    );
  });

  it('selects portrait for a vertical recording', () => {
    expect(initialVideoExportOrientation({ videoWidth: 1080, videoHeight: 1920 })).toBe(
      'portrait'
    );
  });
});
