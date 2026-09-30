import crypto from 'node:crypto';
import express from 'express';

export function safeSecretEquals(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const receivedBuffer = Buffer.from(received, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function createZaloRouter({ webhookSecret, configured, webhookService, logger = console }) {
  const router = express.Router();

  router.get('/api/zalo/status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      configured,
      webhookPath: '/api/zalo/webhook',
    });
  });

  router.post('/api/zalo/webhook', (req, res) => {
    logger.info?.('[zalo-route] webhook request', {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      configured,
      hasSecretHeader: Boolean(req.get('X-Bot-Api-Secret-Token')),
      contentType: req.get('content-type') || null,
    });
    logger.info?.('[zalo-route] webhook raw body', req.body);
    if (!configured || !webhookSecret || webhookSecret.length < 8 || webhookSecret.length > 256) {
      logger.warn?.('[zalo-route] webhook rejected: integration not configured');
      return res.status(503).json({
        ok: false,
        error: 'Zalo integration is not configured.',
      });
    }

    const receivedSecret = req.get('X-Bot-Api-Secret-Token');
    if (!safeSecretEquals(receivedSecret, webhookSecret)) {
      logger.warn?.('[zalo-route] webhook rejected: unauthorized');
      return res.status(403).json({ ok: false, error: 'Unauthorized.' });
    }

    try {
      const result = webhookService.accept(req.body);
      logger.info?.('[zalo-route] webhook accepted', result);
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      logger.error?.('[zalo-route] webhook queue error', {
        code: error.code || error.name || 'unknown',
        message: error.message || 'Webhook could not be queued.',
      });
      return res.status(500).json({ ok: false, error: 'Webhook could not be queued.' });
    }
  });

  return router;
}
