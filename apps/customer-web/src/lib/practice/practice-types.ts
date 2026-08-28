export type PracticeStatus =
  | 'idle'
  | 'connecting'
  | 'arming'
  | 'listening'
  | 'practicing'
  | 'paused'
  | 'finishing'
  | 'finished';

export type PracticeConnectionStatus = 'disconnected' | 'connecting' | 'ready' | 'error';
