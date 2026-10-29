/**
 * Temporary defensive silence safety fuse, not a latency SLO or device qualification.
 * LOAD progress refreshes this window; browser scheduling may delay timer delivery.
 */
export const ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS = 60_000;
