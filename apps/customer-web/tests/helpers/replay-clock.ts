/** Logical offline replay only. Never a product LocalClock or latency measurement. */
export function replayAvailabilityMs(sourcePerformanceCursorMs:number,processingElapsedMs:number):number {
  return Math.max(0,sourcePerformanceCursorMs)+processingElapsedMs;
}
