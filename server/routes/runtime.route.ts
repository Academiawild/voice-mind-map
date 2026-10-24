import { Router, type RequestHandler } from 'express';

export function createRuntimeRouter(shutdown: () => void, shutdownToken: string) {
  const router = Router();
  let shuttingDown = false;

  const handleShutdown: RequestHandler = (req, res) => {
    const token = req.header('x-local-shutdown-token');
    if (token !== shutdownToken) {
      res.status(403).json({
        error: 'Invalid local shutdown token.',
      });
      return;
    }

    if (shuttingDown) {
      res.json({ ok: true });
      return;
    }

    shuttingDown = true;
    res.json({ ok: true });

    setTimeout(() => {
      shutdown();
    }, 150);
  };

  router.post('/runtime/shutdown', handleShutdown);

  return router;
}
