// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getCroppedAvatarFile } from './crop-image';

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
it('crops admitted pixel bounds to a 512x512 PNG File', async () => {
  vi.stubGlobal('Image', class {
    loaded?: () => void;
    addEventListener(kind: string, callback: () => void) {if (kind === 'load') this.loaded = callback;}
    set src(_value: string) {queueMicrotask(() => this.loaded?.());}
  });
  const drawImage = vi.fn();
  const context = {drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: 'low'};
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['pixels'], {type: 'image/png'})));
  const file = await getCroppedAvatarFile('data:image/png;base64,source', {x: 1.4, y: 2.5, width: 100.3, height: 80.9});
  expect(file.name).toBe('avatar.png');
  expect(file.type).toBe('image/png');
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 1, 3, 100, 81, 0, 0, 512, 512);
  expect(getContext.mock.instances[0]).toMatchObject({width: 512, height: 512});
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
});
