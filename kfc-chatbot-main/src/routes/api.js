import express from 'express';
import { z } from 'zod';
import { HandoffMutedError } from '../application/chat-service.js';
import { ZaloApiError } from '../infrastructure/zalo/zalo-client.js';

const chatRequestSchema = z.object({
  sessionId: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  userId: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  message: z.string().trim().min(1).max(4000),
});

const humanMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

function sendSse(res, event, payload) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function validationMessage(error) {
  return error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    || error.message;
}

export function createApiRouter({
  store, chatService, model, menuCount, zaloConfigured = false, zaloClient, logger = console,
}) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      service: 'kfc-conversational-ordering-demo',
      model,
      menuItems: menuCount,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      zaloConfigured,
      time: new Date().toISOString(),
    });
  });

  const chatHandler = async (req, res) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: validationMessage(parsed.error) },
      });
    }

    const { sessionId, userId, message } = parsed.data;
    if (chatService.isBusy(sessionId)) {
      return res.status(409).json({
        error: { code: 'SESSION_BUSY', message: 'Session đang xử lý một tin nhắn khác.' },
      });
    }

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n');
    }, 15000);

    try {
      await chatService.chat({
        sessionId,
        userId,
        message,
        emit: (event, payload) => sendSse(res, event, payload),
      });
    } catch (error) {
      if (error instanceof HandoffMutedError) {
        sendSse(res, 'handoff', {
          code: 'HANDOFF_MUTED',
          message: 'Phiên này đang được nhân viên tiếp quản.',
        });
      } else {
        sendSse(res, 'error', {
          code: error.code || 'CHAT_ERROR',
          message: error.message || 'Không thể xử lý tin nhắn.',
        });
      }
    } finally {
      clearInterval(keepAlive);
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  };

  router.post('/api/chat', chatHandler);
  router.post('/chat', chatHandler);

  router.get('/api/dashboard/snapshot', (req, res) => {
    res.set('Cache-Control', 'no-store').json(
      store.dashboardSnapshot(String(req.query.sessionId || '')),
    );
  });

  router.post('/api/sessions/:id/take-over', (req, res) => {
    const sessionId = String(req.params.id || '');
    if (!store.getSession(sessionId)) {
      return res.status(404).json({
        error: { code: 'SESSION_NOT_FOUND', message: 'Không tìm thấy session.' },
      });
    }
    const result = store.setControlMode(sessionId, 'human');
    return res.json({ sessionId, controlMode: result.controlMode, changed: result.changed });
  });

  router.post('/api/sessions/:id/hand-back', (req, res) => {
    const sessionId = String(req.params.id || '');
    if (!store.getSession(sessionId)) {
      return res.status(404).json({
        error: { code: 'SESSION_NOT_FOUND', message: 'Không tìm thấy session.' },
      });
    }
    const result = store.setControlMode(sessionId, 'bot');
    return res.json({ sessionId, controlMode: result.controlMode, changed: result.changed });
  });

  router.post('/api/sessions/:id/human-message', async (req, res) => {
    const sessionId = String(req.params.id || '');
    const parsed = humanMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: validationMessage(parsed.error) },
      });
    }

    const session = store.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: { code: 'SESSION_NOT_FOUND', message: 'Không tìm thấy session.' },
      });
    }
    if (session.controlMode !== 'human') {
      return res.status(409).json({
        error: {
          code: 'SESSION_NOT_HUMAN_CONTROLLED',
          message: 'Phiên này chưa được tiếp quản. Hãy bấm "Tiếp quản" trước khi gửi tin nhắn.',
        },
      });
    }
    if (!session.zaloChatId) {
      return res.status(409).json({
        error: { code: 'NO_ZALO_CHAT_ID', message: 'Phiên này chưa có địa chỉ Zalo để gửi tin nhắn.' },
      });
    }

    const { message } = parsed.data;
    try {
      await zaloClient.sendMessage(session.zaloChatId, message);
    } catch (error) {
      logger.error?.('[api] human-message zalo send failed', {
        sessionId,
        code: error instanceof ZaloApiError ? error.code : (error.code || error.name || 'unknown'),
      });
      return res.status(502).json({
        error: { code: 'ZALO_SEND_FAILED', message: 'Không thể gửi tin nhắn qua Zalo. Vui lòng thử lại.' },
      });
    }

    store.addMessage(sessionId, 'human_agent', message);
    return res.json({ sessionId, sent: true });
  });

  router.post('/api/demo/reset', (req, res) => {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;
    if (sessionId && chatService.isBusy(sessionId)) {
      return res.status(409).json({
        error: { code: 'SESSION_BUSY', message: 'Không thể reset khi agent đang xử lý.' },
      });
    }
    return res.json(sessionId ? store.resetSession(sessionId) : store.resetAll());
  });

  return router;
}
