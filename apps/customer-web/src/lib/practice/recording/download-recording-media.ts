import { releaseRecordingMedia } from '@/lib/practice/recording/recording-media-resource';
import type { PerformanceRecording } from './recording-artifact';

/** The object URL and the browser download retain their backing file until URL retirement. */
export async function downloadRecordingMedia(recording: Extract<PerformanceRecording, { status: 'READY' }>, filename: string): Promise<void> {
  const lease = recording.resource.retain();
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(recording.blob);
    anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click();
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
  } finally {
    anchor?.remove();
    try { if (url) URL.revokeObjectURL(url); } finally { await releaseRecordingMedia(lease); }
  }
}
