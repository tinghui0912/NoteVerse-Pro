export type ScorePlaybackState = 'PLAYING' | 'PAUSED' | 'STOPPED' | 'IDLE';

export interface ScorePlaybackSnapshot {
  state: ScorePlaybackState;
  currentStep: number;
  totalSteps: number;
  currentTime: number;
  duration: number;
}

export type ScoreCursorScrollTarget = 'container' | 'window';

export interface CursorVisibilityOptions {
  scrollTarget?: ScoreCursorScrollTarget;
  force?: boolean;
}

export interface CursorSyncOptions extends CursorVisibilityOptions {
  scrollIntoView?: boolean;
}

export interface ScoreRenderer {
  loadScore(xmlString: string): Promise<void>;
  fitToContainer(): Promise<void>;
  dispose(): void;
}

export interface ScorePlaybackController {
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  playFromStep(step: number): Promise<void>;
  setTempo(bpm: number): void;
  getPlaybackSnapshot(): ScorePlaybackSnapshot;
  onPlaybackIteration(listener: (notes: unknown[]) => void): void;
  onPlaybackStateChange(listener: (state: ScorePlaybackState) => void): void;
}

export interface ScoreCursorController {
  resetCursor(options?: CursorSyncOptions): void;
  syncCursorToStep(step: number, options?: CursorSyncOptions): void;
  ensureCursorVisible(options?: CursorVisibilityOptions): void;
}

export type ScorePreviewController = ScoreRenderer &
  ScorePlaybackController &
  ScoreCursorController;
