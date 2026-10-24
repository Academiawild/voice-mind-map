import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path, { dirname, resolve } from 'node:path';
import {
  CaptureJournalSchema,
  CaptureRecordSchema,
  type CaptureJournal,
  type CaptureRecord,
} from '../../../shared/capture';

const EMPTY_JOURNAL: CaptureJournal = { schemaVersion: 1, records: [] };
const MAX_RECORDS = 500;

export class CaptureJournalError extends Error {
  constructor(
    message: string,
    readonly code: 'CAPTURE_NOT_FOUND' | 'CAPTURE_NOT_RECOGNIZED',
  ) {
    super(message);
    this.name = 'CaptureJournalError';
  }
}

export class CaptureJournalStore {
  private loaded: Promise<CaptureJournal> | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly journalPath = resolve(process.cwd(), '.runtime', 'capture-journal-v2.json'),
  ) {}

  private async load() {
    if (!this.loaded) {
      this.loaded = readFile(this.journalPath, 'utf8')
        .then((content) => CaptureJournalSchema.parse(JSON.parse(content)))
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return structuredClone(EMPTY_JOURNAL);
          throw error;
        });
    }
    return this.loaded;
  }

  private async persist(journal: CaptureJournal) {
    await mkdir(dirname(this.journalPath), { recursive: true });
    const temporaryPath = `${this.journalPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.journalPath);
    this.loaded = Promise.resolve(journal);
  }

  private mutate<T>(mutation: (journal: CaptureJournal) => Promise<T> | T): Promise<T> {
    const next = this.mutationQueue.then(async () => {
      const journal = structuredClone(await this.load());
      const result = await mutation(journal);
      journal.records = journal.records.slice(-MAX_RECORDS);
      await this.persist(CaptureJournalSchema.parse(journal));
      return result;
    });
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }

  async recordRecognized(input: {
    source: 'file' | 'realtime';
    transcript: string;
    recordingDir: string;
  }) {
    return this.mutate((journal) => {
      const now = new Date().toISOString();
      const record = CaptureRecordSchema.parse({
        id: randomUUID(),
        status: 'recognized',
        source: input.source,
        transcript: input.transcript,
        recordingDir: path.resolve(input.recordingDir),
        createdAt: now,
        updatedAt: now,
      });
      journal.records.push(record);
      return record;
    });
  }

  async recordFailed(input: { source: 'file' | 'realtime'; error: string }) {
    return this.mutate((journal) => {
      const now = new Date().toISOString();
      const record = CaptureRecordSchema.parse({
        id: randomUUID(),
        status: 'failed',
        source: input.source,
        error: input.error,
        createdAt: now,
        updatedAt: now,
      });
      journal.records.push(record);
      return record;
    });
  }

  async listPending(limit = 20): Promise<CaptureRecord[]> {
    const journal = await this.mutationQueue.then(() => this.load());
    return journal.records
      .filter((record) => record.status === 'recognized')
      .slice(-Math.max(1, Math.min(limit, 100)))
      .reverse();
  }

  async markOrganized(id: string) {
    return this.mutate((journal) => {
      const index = journal.records.findIndex((record) => record.id === id);
      const current = journal.records[index];
      if (!current) {
        throw new CaptureJournalError('Capture not found.', 'CAPTURE_NOT_FOUND');
      }
      if (current.status === 'organized') return current;
      if (current.status !== 'recognized') {
        throw new CaptureJournalError(
          'Only recognized captures can be organized.',
          'CAPTURE_NOT_RECOGNIZED',
        );
      }
      const organized = CaptureRecordSchema.parse({
        ...current,
        status: 'organized',
        updatedAt: new Date().toISOString(),
      });
      journal.records[index] = organized;
      return organized;
    });
  }
}
