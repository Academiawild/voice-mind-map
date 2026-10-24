import { Router } from 'express';
import { z } from 'zod/v4';
import {
  CaptureOrganizedResponseSchema,
  PendingCapturesResponseSchema,
} from '../../shared/capture';
import {
  CaptureJournalError,
  type CaptureJournalStore,
} from '../modules/capture-journal/capture-journal';

const CaptureIdSchema = z.string().uuid();

export function createCapturesRouter(journal: CaptureJournalStore) {
  const router = Router();

  router.get('/captures/pending', async (_req, res) => {
    try {
      res.json(PendingCapturesResponseSchema.parse({ captures: await journal.listPending() }));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to read pending captures.',
        code: 'CAPTURE_JOURNAL_FAILED',
      });
    }
  });

  router.post('/captures/:id/organized', async (req, res) => {
    const parsedId = CaptureIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid capture id.', code: 'INVALID_CAPTURE_ID' });
      return;
    }
    try {
      res.json(
        CaptureOrganizedResponseSchema.parse({
          capture: await journal.markOrganized(parsedId.data),
        }),
      );
    } catch (error) {
      const status = error instanceof CaptureJournalError ? 409 : 500;
      res.status(status).json({
        error: error instanceof Error ? error.message : 'Unable to organize capture.',
        code: error instanceof CaptureJournalError ? error.code : 'CAPTURE_JOURNAL_FAILED',
      });
    }
  });

  return router;
}
