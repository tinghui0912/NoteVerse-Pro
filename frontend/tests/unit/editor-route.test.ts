import { describe, expect, it } from 'vitest';
import { getEditorSaveTarget, parseEditorSource } from '@/lib/editor/route';

describe('editor route contract', () => {
  it('accepts only explicit supported sources', () => {
    expect(parseEditorSource('current')).toBe('current');
    expect(parseEditorSource('final')).toBe('final');
    expect(parseEditorSource('enhanced')).toBeNull();
    expect(parseEditorSource('invalid')).toBeNull();
    expect(parseEditorSource(null)).toBeNull();
  });

  it('keeps review and results save targets distinct', () => {
    expect(getEditorSaveTarget('current', 'task')).toEqual({
      fileType: 'current_xml',
      imageType: 'preview_image',
      redirectTo: '/review/task',
    });
    expect(getEditorSaveTarget('final', 'task')).toEqual({
      fileType: 'final_xml',
      imageType: 'final_image',
      redirectTo: '/results/task',
    });
    expect(getEditorSaveTarget('final', 'task', '/share/token')).toMatchObject({
      fileType: 'final_xml',
      imageType: 'final_image',
      redirectTo: '/share/token',
    });
  });
});
