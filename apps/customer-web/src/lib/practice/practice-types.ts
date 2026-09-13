export type PracticeStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'practicing'
  | 'paused'
  | 'finishing'
  | 'finished';

export type PracticeConnectionStatus = 'disconnected' | 'connecting' | 'ready' | 'error';
