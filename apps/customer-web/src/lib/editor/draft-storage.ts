import Dexie, { type Table } from 'dexie';

export interface DraftEntry {
  draftId: string;
  scoreId: string;
  baselineRevisionId: string;
  xml: string;
  savedAt: number;
}

class DraftDatabase extends Dexie {
  drafts!: Table<DraftEntry, string>;

  constructor() {
    super('NoteVerseEditorDrafts');
    this.version(2).stores({
      drafts: 'draftId, scoreId, baselineRevisionId, savedAt',
    }).upgrade((transaction) => transaction.table('drafts').clear());
  }
}

let db: DraftDatabase | null = null;

function getDB(): DraftDatabase {
  if (!db && typeof window !== 'undefined') db = new DraftDatabase();
  if (!db) throw new Error('IndexedDB is not available');
  return db;
}

function draftId(scoreId: string, baselineRevisionId: string) {
  return `${scoreId}:${baselineRevisionId}`;
}

function draftTable() {
  return getDB().drafts;
}

export async function saveDraft(
  scoreId: string,
  baselineRevisionId: string,
  xml: string
): Promise<void> {
  try {
    await draftTable().put({
      draftId: draftId(scoreId, baselineRevisionId),
      scoreId,
      baselineRevisionId,
      xml,
      savedAt: Date.now(),
    });
  } catch {}
}

export async function loadDraft(
  scoreId: string,
  baselineRevisionId: string
): Promise<DraftEntry | undefined> {
  try {
    return await draftTable().get(draftId(scoreId, baselineRevisionId));
  } catch {
    return undefined;
  }
}

export async function deleteDraft(scoreId: string, baselineRevisionId: string): Promise<void> {
  try {
    await draftTable().delete(draftId(scoreId, baselineRevisionId));
  } catch {}
}

export async function cleanOldDrafts(maxAgeDays = 7): Promise<number> {
  try {
    const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const oldDrafts = draftTable().where('savedAt').below(threshold);
    const count = await oldDrafts.count();
    await oldDrafts.delete();
    return count;
  } catch {
    return 0;
  }
}
