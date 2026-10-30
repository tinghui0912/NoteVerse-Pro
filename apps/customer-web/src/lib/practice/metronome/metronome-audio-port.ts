/** Optional audio aid. All methods are nonthrowing; disposal releases only owned audio. */
export type MetronomeAudioPort = Readonly<{
  activate(): void;
  nowMs(): number;
  scheduleClick(input: Readonly<{ atMs: number; accent: boolean }>): void;
  dispose(): void | Promise<void>;
}>;
