/** A terminal analysis failure after admission, independent of input/recording health. */
export type ContinuousAnalysisIntervention = Readonly<{
  pauseOrigin: 'INTERVENTION' | 'USER';
}>;
