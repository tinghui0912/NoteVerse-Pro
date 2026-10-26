import type { RecordingRuntimeFault } from '@/lib/practice/recording/recording-runtime-fault';
export type RecordingIntervention = RecordingRuntimeFault & Readonly<{
  state: 'WAITING_FOR_USER'; pauseOrigin: 'RECORDING' | 'USER';
}>;
