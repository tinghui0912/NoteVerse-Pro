import type { TranscriptionBatchJob } from './chunk-planner';

type QueueState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
type QueueLifecycle = 'OPEN' | 'SEALED' | 'FAILED' | 'DRAINED';

type QueueEntry<T> = {
  job: SequencedTranscriptionBatchJob;
  state: QueueState;
  result?: T;
  error?: Error;
};

export type PublishedTranscriptionResult<T> = {
  job: SequencedTranscriptionBatchJob;
  result: T;
  ownedTrustedStartSample: number;
  ownedTrustedEndSample: number;
};

export class ContinuousTranscriptionQueue<T> {
  private readonly entries: QueueEntry<T>[] = [];
  private lifecycle: QueueLifecycle = 'OPEN';
  private nextClaimIndex = 0;
  private nextPublishIndex = 0;
  private pendingCount = 0;
  private runningCount = 0;
  private completedCount = 0;
  private nextSequence = 0;

  enqueue(job: TranscriptionBatchJob): void {
    if (this.lifecycle !== 'OPEN') {
      throw new Error('Cannot enqueue transcription work unless the queue is OPEN.');
    }
    const sequencedJob = { ...job, sequence: this.nextSequence };
    this.nextSequence += 1;
    this.entries.push({ job: sequencedJob, state: 'PENDING' });
    this.pendingCount += 1;
  }

  claimNext(): SequencedTranscriptionBatchJob | null {
    if (this.lifecycle === 'FAILED' || this.lifecycle === 'DRAINED') {
      return null;
    }
    while (this.nextClaimIndex < this.entries.length) {
      const entry = this.entries[this.nextClaimIndex];
      this.nextClaimIndex += 1;
      if (entry.state !== 'PENDING') {
        continue;
      }
      entry.state = 'RUNNING';
      this.pendingCount -= 1;
      this.runningCount += 1;
      return entry.job;
    }
    return null;
  }

  complete(sequence: number, result: T): PublishedTranscriptionResult<T>[] {
    const entry = this.entry(sequence);
    if (entry.state !== 'RUNNING') {
      throw new Error('Only RUNNING transcription jobs can be completed.');
    }
    entry.state = 'COMPLETED';
    entry.result = result;
    this.runningCount -= 1;
    this.completedCount += 1;
    return this.flushReadyResults();
  }

  fail(sequence: number, error: Error): void {
    const entry = this.entry(sequence);
    if (entry.state === 'PENDING') {
      this.pendingCount -= 1;
    } else if (entry.state === 'RUNNING') {
      this.runningCount -= 1;
    } else if (entry.state === 'COMPLETED') {
      this.completedCount -= 1;
    }
    entry.state = 'FAILED';
    entry.error = error;
    this.lifecycle = 'FAILED';
  }

  seal(): void {
    if (this.lifecycle !== 'OPEN') {
      throw new Error('Only OPEN transcription queues can be sealed.');
    }
    this.lifecycle = this.nextPublishIndex >= this.entries.length ? 'DRAINED' : 'SEALED';
  }

  snapshot(): {
    pendingCount: number;
    runningCount: number;
    completedCount: number;
    lifecycle: QueueLifecycle;
    queuedBatchCount: number;
    nextClaimIndex: number;
    nextPublishIndex: number;
  } {
    return {
      pendingCount: this.pendingCount,
      runningCount: this.runningCount,
      completedCount: this.completedCount,
      lifecycle: this.lifecycle,
      queuedBatchCount: this.entries.length - this.nextPublishIndex,
      nextClaimIndex: this.nextClaimIndex,
      nextPublishIndex: this.nextPublishIndex,
    };
  }

  private entry(sequence: number): QueueEntry<T> {
    const entry = this.entries[sequence];
    if (!entry || entry.job.sequence !== sequence) {
      throw new Error(`Unknown transcription job sequence ${sequence}.`);
    }
    return entry;
  }

  private flushReadyResults(): PublishedTranscriptionResult<T>[] {
    const ready: PublishedTranscriptionResult<T>[] = [];
    while (this.nextPublishIndex < this.entries.length) {
      const entry = this.entries[this.nextPublishIndex];
      if (entry.state !== 'COMPLETED') {
        break;
      }
      ready.push({
        job: entry.job,
        result: entry.result as T,
        ownedTrustedStartSample: entry.job.ownedTrustedStartSample,
        ownedTrustedEndSample: entry.job.ownedTrustedEndSample,
      });
      this.completedCount -= 1;
      this.nextPublishIndex += 1;
    }
    if (
      this.lifecycle === 'SEALED' &&
      this.nextPublishIndex >= this.entries.length &&
      this.runningCount === 0 &&
      this.pendingCount === 0
    ) {
      this.lifecycle = 'DRAINED';
    }
    return ready;
  }
}

export type SequencedTranscriptionBatchJob = TranscriptionBatchJob & {
  sequence: number;
};
