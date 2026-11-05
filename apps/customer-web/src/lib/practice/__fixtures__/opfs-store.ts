import { vi } from 'vitest';
import type { OpfsMediaStoragePlatform } from '../recording/opfs-owned-media-file';

export function opfsStoreFixture() {
  const files = new Map<string, Blob[]>();
  const held = new Set<string>();
  let identity = 0;
  const write = vi.fn(async (id: string, blob: Blob) => { files.get(id)!.push(blob); });
  const close = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  const remove = vi.fn(async (id: string) => { files.delete(id); });
  const directory = {
    getDirectoryHandle: vi.fn(async () => directory),
    getFileHandle: vi.fn(async (id: string) => {
      files.set(id, []);
      return {
        createWritable: async () => ({ write: (chunk: Blob) => write(id, chunk), close, abort }),
        getFile: async () => new File(files.get(id)!, id),
      };
    }),
    removeEntry: remove,
    async *values() { for (const name of [...files.keys()]) yield { name, kind: 'file' }; },
  };
  const request = vi.fn(async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (options.ifAvailable && options.signal) throw new DOMException('ifAvailable and signal are exclusive', 'NotSupportedError');
    options.signal?.throwIfAborted();
    if (held.has(name)) {
      if (!options.ifAvailable) throw new Error('Unexpected blocking lock in fixture.');
      return callback(null);
    }
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' } as Lock); }
    finally { held.delete(name); }
  });
  const platform: OpfsMediaStoragePlatform = {
    root: async () => directory,
    randomId: () => `capture-${++identity}`,
    locks: { request } as unknown as LockManager,
  };
  return { platform, files, held, write, close, abort, remove, directory };
}
