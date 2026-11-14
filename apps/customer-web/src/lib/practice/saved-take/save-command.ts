import { recordedPerformance } from '@/lib/practice/recording/recorded-performance';
import { releaseLocalMediaAsset } from '@/lib/practice/media/local-media-asset';
import type { performanceTakesApi } from '@/lib/api/performance-takes';
import {
  performanceTakeUploadRequest,
  savedTakeAgreesWithRecordedPerformance,
  takeManifestAgreesWithRecordedPerformance,
  type SavePerformanceTakeInput,
} from './save';

type SaveTransport = Pick<typeof performanceTakesApi, 'reserveUpload' | 'cancelUploadReservation' | 'finalizeTake'>;

/** One Save operation. Construction synchronously retains exactly one media lease. */
export class PerformanceTakeSaveCommand {
  private readonly input: SavePerformanceTakeInput;
  private released = false;
  private result: ReturnType<PerformanceTakeSaveCommand['run']> | null = null;

  constructor(
    input: SavePerformanceTakeInput,
    private readonly transport: SaveTransport,
    private readonly upload: (url: string, method: string, headers: Record<string, string>, body: Blob) => Promise<void>,
  ) {
    const lease = input.recordedPerformance.recording.media.retain();
    this.input = {
      ...input,
      recordedPerformance: recordedPerformance(
        input.recordedPerformance.executed,
        Object.freeze({ ...input.recordedPerformance.recording, media: lease }),
      ),
    };
  }

  execute() {
    if (this.released && !this.result) throw new Error('Save command is released');
    this.result ??= this.run().finally(() => this.release());
    return this.result;
  }

  async release() {
    if (this.released) return;
    this.released = true;
    await releaseLocalMediaAsset(this.input.recordedPerformance.recording.media);
  }

  private async run() {
    const request = performanceTakeUploadRequest(this.input);
    const response = await this.transport.reserveUpload(request);
    const reservation = response;
    if (!reservation) throw new Error('Upload reservation is unavailable');
    if (
      !takeManifestAgreesWithRecordedPerformance(
        reservation.manifest,
        this.input.recordedPerformance,
      )
    ) {
      if (reservation.status === 'RESERVED') {
        try {
          await this.transport.cancelUploadReservation(
            reservation.reservation_id,
          );
        } catch {
          // Expiry processing retains cleanup ownership if cancellation is unavailable.
        }
      }
      throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
    }
    if (reservation.status === 'COMPLETED') {
      if (!reservation.take)
        throw new Error('Completed reservation has no saved take');
      if (
        !takeManifestAgreesWithRecordedPerformance(
          reservation.take.manifest,
          this.input.recordedPerformance,
        ) ||
        !savedTakeAgreesWithRecordedPerformance(
          reservation.take,
          this.input.recordedPerformance,
        )
      )
        throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
      return reservation.take;
    }
    if (reservation.status === 'RESERVED') {
      const target = reservation.upload_target;
      if (!target) throw new Error('Reserved upload has no upload target');
      try {
        await this.upload(
          target.url,
          target.method,
          target.headers,
          this.input.recordedPerformance.recording.media.blob,
        );
      } catch (error) {
        try {
          await this.transport.cancelUploadReservation(
            reservation.reservation_id,
          );
        } catch {
          // Reservation expiry processing retains cleanup ownership.
        }
        throw error;
      }
    }
    // Unknown finalize outcomes retain the reservation for an idempotent retry.
    const finalized = await this.transport.finalizeTake(
      reservation.reservation_id,
    );
    if (
      !finalized ||
      !takeManifestAgreesWithRecordedPerformance(
        finalized.manifest,
        this.input.recordedPerformance,
      ) ||
      !savedTakeAgreesWithRecordedPerformance(
        finalized,
        this.input.recordedPerformance,
      )
    )
      throw new Error('PERFORMANCE_TAKE_PLAN_MISMATCH');
    return finalized;
  }
}
