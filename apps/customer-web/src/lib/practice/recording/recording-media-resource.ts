import { reportUnexpectedClientError } from '@/lib/observability';
import type { RecordingMediaResource } from './recording-sink';

/** A sealed file is deleted only after every explicit owner retires. */
export function createRecordingMediaResource(remove: () => Promise<void>): RecordingMediaResource {
  let references = 0;
  const lease = (): RecordingMediaResource => {
    references++;
    let released: Promise<void> | null = null;
    return Object.freeze({
      retain() {
        if (released) throw new Error('Recording media owner is retired.');
        return lease();
      },
      release() {
        if (!released) {
          references--;
          released = references === 0 ? Promise.resolve().then(remove) : Promise.resolve();
        }
        return released;
      },
    });
  };
  return lease();
}

/** Published media retirement reports IO failure and leaves an unlocked orphan for recovery. */
export async function releaseRecordingMedia(resource: RecordingMediaResource): Promise<void> {
  try { await resource.release(); }
  catch (error) { reportUnexpectedClientError(error, { area: 'practice', operation: 'capture_media_remove' }); }
}
