import { Router } from 'express';
import { MindMapChangeRequestSchema } from '../../shared/mind-map';
import { isNormalizedAIError } from '../infrastructure/ai/ai-errors';
import type { MindMapChangeService } from '../modules/ai/mind-map-change.service';

export function createMindMapChangeRouter(service: MindMapChangeService, debugMindMap: boolean) {
  const router = Router();

  router.post('/mind-map/change', async (req, res) => {
    const parsed = MindMapChangeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid mind map change request.',
        code: 'INVALID_REQUEST',
        issues: parsed.error.issues,
      });
      return;
    }

    const abort = new AbortController();
    const onDisconnect = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.once('aborted', onDisconnect);
    res.once('close', onDisconnect);
    try {
      const result = await service.change(parsed.data, abort.signal);
      if (!abort.signal.aborted) res.json(result);
    } catch (error) {
      if (abort.signal.aborted) return;
      const details = error as Error & { code?: string; issues?: unknown; rawPayload?: unknown };
      const payload: Record<string, unknown> = {
        error: error instanceof Error ? error.message : 'Mind map change failed.',
        code: details.code ?? 'MIND_MAP_CHANGE_FAILED',
      };
      if (details.issues) {
        payload.issues = details.issues;
      }
      if (debugMindMap && details.rawPayload) {
        payload.rawPayload = details.rawPayload;
      }
      const status =
        isNormalizedAIError(error) && error.code === 'AI_NOT_READY'
          ? 503
          : isNormalizedAIError(error) && error.code === 'AI_BAD_RESPONSE'
            ? 422
            : 500;
      res.status(status).json(payload);
    } finally {
      req.off('aborted', onDisconnect);
      res.off('close', onDisconnect);
    }
  });

  return router;
}
