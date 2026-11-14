export type StepExecutionCommands = Readonly<{
  mode: 'STEP_BY_STEP';
  skip(): void;
  setMetronomeEnabled(enabled: boolean): void;
}>;
