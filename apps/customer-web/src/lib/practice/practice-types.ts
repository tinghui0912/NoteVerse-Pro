export type PracticeStatus =
  | 'idle'
  | 'connecting'
  | 'arming'
  | 'listening'
  | 'practicing'
  | 'paused'
  | 'finished';

export type PracticeConnectionStatus = 'disconnected' | 'connecting' | 'ready' | 'error';
