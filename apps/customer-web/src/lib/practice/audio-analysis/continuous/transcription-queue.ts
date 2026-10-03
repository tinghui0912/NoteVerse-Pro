import type { TranscriptionBatchJob } from './chunk-planner';

type QueueState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

type QueueEntry<T> = {
  job: TranscriptionBatchJob;
  state: QueueState;
  result?: T;
  error?: Error;
};

export class ContinuousTranscriptionQueue<T> {
  private readonly entries: QueueEntry<T>[] = [];
  private nextPublishIndex = 0;
  private failed = false;

  enqueue(job: TranscriptionBatchJob): void {
    if (this.failed) {
      throw new Error('Cannot enqueue transcription work after queue failure.');
    }
    if (job.sequence !== this.entries.length) {
      throw new Error('Transcription jobs must be enqueued in contiguous FIFO sequence.');
    }
    this.entries.push({ job, state: 'PENDING' });
  }

  claimNext(): TranscriptionBatchJob | null {
    if (this.failed) {
      return null;
    }
    const entry = this.entries.find((item) => item.state === 'PENDING');
    if (!entry) {
      return null;
    }
    entry.state = 'RUNNING';
    return entry.job;
  }

  complete(sequence: number, result: T): T[] {
    const entry = this.entry(sequence);
    if (entry.state !== 'RUNNING') {
      throw new Error('Only RUNNING transcription jobs can be completed.');
    }
    entry.state = 'COMPLETED';
    entry.result = result;
    return this.flushReadyResults();
  }

  fail(sequence: number, error: Error): void {
    const entry = this.entry(sequence);
    entry.state = 'FAILED';
    entry.error = error;
    this.failed = true;
  }

  snapshot(): {
    pendingCount: number;
    runningCount: number;
    completedCount: number;
    failed: boolean;
    queuedBatchCount: number;
  } {
    return {
      pendingCount: this.entries.filter((entry) => entry.state === 'PENDING').length,
      runningCount: this.entries.filter((entry) => entry.state === 'RUNNING').length,
      completedCount: this.entries.filter((entry) => entry.state === 'COMPLETED').length,
      failed: this.failed,
      queuedBatchCount: this.entries.length - this.nextPublishIndex,
    };
  }

  private entry(sequence: number): QueueEntry<T> {
    const entry = this.entries[sequence];
    if (!entry || entry.job.sequence !== sequence) {
      throw new Error(`Unknown transcription job sequence ${sequence}.`);
    }
    return entry;
  }

  private flushReadyResults(): T[] {
    const ready: T[] = [];
    while (this.nextPublishIndex < this.entries.length) {
      const entry = this.entries[this.nextPublishIndex];
      if (entry.state !== 'COMPLETED') {
        break;
      }
      ready.push(entry.result as T);
      this.nextPublishIndex += 1;
    }
    return ready;
  }
}
