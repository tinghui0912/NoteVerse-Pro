export type ContinuousExecutionCommands = Readonly<{
  mode: 'CONTINUOUS_PLAY';
  pause(): void;
  resume(): void;
  setMetronomeEnabled(enabled: boolean): void;
  continueWithoutAnalysis(): Promise<void>;
  continueWithoutRecording(): void;
  continueAfterRecovery(): boolean;
}>;
