import type { PracticePlan } from "@/lib/practice/planning/practice-plan";

export type LocalPracticeCompletionReason =
  "SCOPE_COMPLETED" | "STOPPED_BY_USER";

/** A concrete local Start execution. All resolved musical truth belongs to its plan. */
export type PracticeSession<P extends PracticePlan = PracticePlan> = Readonly<{
  localSessionId: string;
  plan: P;
  completionReason: LocalPracticeCompletionReason | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export function createLocalSessionId(prefix = "local-practice"): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}
