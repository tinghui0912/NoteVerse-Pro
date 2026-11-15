const REALTIME_CHANGE_SCHEMA_VERSION = 1;

type ChangeBase = {
  schemaVersion: 1;
  sequence: number;
  changeId: string;
  createdAt: string;
};
export type RealtimeChange = ChangeBase &
  (
    | { kind: 'notifications.changed'; notificationId: string | null }
    | { kind: 'score.revisions.changed'; scoreId: string; revisionId: string }
    | {
        kind: 'score.derived_assets.changed';
        scoreId: string;
        revisionId: string;
      }
    | { kind: 'score.metadata.changed'; scoreId: string; revisionId: string }
    | { kind: 'import_jobs.changed'; importJobId: string }
  );

export function parseRealtimeChange(data: string): RealtimeChange | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (
      v.schemaVersion !== REALTIME_CHANGE_SCHEMA_VERSION ||
      !Number.isSafeInteger(v.sequence) ||
      (v.sequence as number) <= 0 ||
      typeof v.changeId !== 'string' ||
      !v.changeId ||
      typeof v.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(v.createdAt))
    )
      return null;
    const base: ChangeBase = {
      schemaVersion: REALTIME_CHANGE_SCHEMA_VERSION,
      sequence: v.sequence as number,
      changeId: v.changeId,
      createdAt: v.createdAt,
    };
    switch (v.kind) {
      case 'notifications.changed':
        return v.notificationId === null || typeof v.notificationId === 'string'
          ? { ...base, kind: v.kind, notificationId: v.notificationId }
          : null;
      case 'score.revisions.changed':
      case 'score.derived_assets.changed':
      case 'score.metadata.changed':
        return typeof v.scoreId === 'string' &&
          !!v.scoreId &&
          typeof v.revisionId === 'string' &&
          !!v.revisionId
          ? {
              ...base,
              kind: v.kind,
              scoreId: v.scoreId,
              revisionId: v.revisionId,
            }
          : null;
      case 'import_jobs.changed':
        return typeof v.importJobId === 'string' && !!v.importJobId
          ? { ...base, kind: v.kind, importJobId: v.importJobId }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
