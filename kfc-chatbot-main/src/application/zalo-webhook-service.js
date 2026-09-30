import crypto from 'node:crypto';
import { HandoffMutedError } from './chat-service.js';

const PROVIDER = 'zalo';
const TEXT_EVENT = 'message.text.received';
const FAILURE_REPLY = 'Xin lỗi bạn, hệ thống đang bận một chút. Bạn vui lòng gửi lại tin nhắn sau ít phút nhé.';

function hashId(prefix, value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function fallbackEventId(message) {
  return crypto.createHash('sha256').update([
    message.chat?.id,
    message.from?.id,
    message.date,
    message.text,
  ].map((value) => String(value ?? '')).join('\u0000')).digest('hex');
}

function getWebhookPayloadData(payload) {
  return payload?.result ?? payload ?? {};
}

export function parseZaloTextEvent(payload) {
  const data = getWebhookPayloadData(payload);
  const eventName = data?.event_name;
  if (eventName !== TEXT_EVENT) {
    return { supported: false, reason: 'unsupported_event', eventName: eventName || null };
  }

  const message = data?.message;
  const chatId = message?.chat?.id;
  const fromId = message?.from?.id;
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  if (!chatId || !fromId || !text || message?.from?.is_bot === true) {
    return { supported: false, reason: 'invalid_or_bot_message', eventName };
  }

  return {
    supported: true,
    eventName,
    externalId: String(message.message_id || fallbackEventId(message)),
    sessionId: hashId('zalo_chat', `${chatId}:${fromId}`),
    userId: hashId('zalo_user', fromId),
    chatId: String(chatId),
    text,
  };
}

export class ZaloWebhookService {
  constructor({ store, chatService, zaloClient, logger = console }) {
    this.store = store;
    this.chatService = chatService;
    this.zaloClient = zaloClient;
    this.logger = logger;
    this.queueTails = new Map();
  }

  accept(payload) {
    const payloadData = getWebhookPayloadData(payload);
    this.logger.info?.('[zalo] webhook accepted', {
      eventName: payloadData?.event_name || null,
      messageId: payloadData?.message?.message_id || null,
    });
    this.logger.info?.('[zalo] webhook raw payload', payload);
    const event = parseZaloTextEvent(payload);
    if (!event.supported) {
      this.logger.info?.('[zalo] webhook ignored', {
        reason: event.reason,
        eventName: event.eventName || null,
      });
      return { accepted: true, ignored: true, reason: event.reason };
    }

    this.logger.info?.('[zalo] webhook parsed', {
      externalId: event.externalId,
      sessionId: event.sessionId,
      chatId: event.chatId,
      textLength: event.text.length,
    });

    const claim = this.store.claimWebhookEvent({
      provider: PROVIDER,
      externalId: event.externalId,
      sessionId: event.sessionId,
    });
    if (!claim.claimed) {
      this.logger.info?.('[zalo] duplicate webhook ignored', {
        externalId: event.externalId,
        sessionId: event.sessionId,
        status: claim.event?.status || 'unknown',
      });
      return {
        accepted: true,
        duplicate: true,
        status: claim.event?.status || 'unknown',
        sessionId: event.sessionId,
      };
    }

    this.logger.info?.('[zalo] webhook queued', {
      externalId: event.externalId,
      sessionId: event.sessionId,
    });
    this.enqueue(event.sessionId, () => this.process(event)).catch((error) => {
      this.logger.error?.(`[zalo] queue failed: ${error.code || error.name || 'unknown'}`);
    });
    return { accepted: true, queued: true, sessionId: event.sessionId };
  }

  enqueue(sessionId, task) {
    const previous = this.queueTails.get(sessionId) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    const tracked = current.finally(() => {
      if (this.queueTails.get(sessionId) === tracked) this.queueTails.delete(sessionId);
    });
    this.queueTails.set(sessionId, tracked);
    return tracked;
  }

  async process(event) {
    let replySent = false;
    try {
      this.logger.info?.('[zalo] process start', {
        externalId: event.externalId,
        sessionId: event.sessionId,
        chatId: event.chatId,
      });
      try {
        this.logger.info?.('[zalo] typing start', { chatId: event.chatId });
        await this.zaloClient.sendTyping(event.chatId);
        this.logger.info?.('[zalo] typing sent', { chatId: event.chatId });
      } catch (error) {
        this.logger.warn?.(`[zalo] typing failed: ${error.code || error.name || 'unknown'}`);
      }

      this.logger.info?.('[zalo] chatService start', {
        sessionId: event.sessionId,
        userId: event.userId,
        textLength: event.text.length,
      });
      const reply = await this.chatService.chat({
        sessionId: event.sessionId,
        userId: event.userId,
        message: event.text,
        zaloChatId: event.chatId,
        emit: () => {},
      });
      this.logger.info?.('[zalo] chatService done', {
        sessionId: event.sessionId,
        replyLength: reply?.length || 0,
      });
      if (!reply?.trim()) throw new Error('Agent returned an empty reply.');

      this.logger.info?.('[zalo] send reply start', {
        chatId: event.chatId,
        replyLength: reply.length,
      });
      const results = await this.zaloClient.sendMessage(event.chatId, reply);
      replySent = true;
      const replyIds = results
        .map((result) => result?.message_id)
        .filter(Boolean)
        .map(String);
      this.logger.info?.('[zalo] send reply done', {
        chatId: event.chatId,
        replyIds,
      });
      try {
        this.store.completeWebhookEvent(PROVIDER, event.externalId, replyIds);
        this.logger.info?.('[zalo] webhook completed', {
          externalId: event.externalId,
          sessionId: event.sessionId,
        });
      } catch (error) {
        this.logger.error?.(`[zalo] completion status failed: ${error.code || error.name || 'unknown'}`);
      }
    } catch (error) {
      if (error instanceof HandoffMutedError) {
        this.logger.info?.('[zalo] reply suppressed: session handed off to human', {
          externalId: event.externalId,
          sessionId: event.sessionId,
        });
        try {
          this.store.completeWebhookEvent(PROVIDER, event.externalId, []);
        } catch (statusError) {
          this.logger.error?.(`[zalo] completion status failed: ${statusError.code || statusError.name || 'unknown'}`);
        }
        return;
      }

      this.logger.error?.('[zalo] process failed', {
        externalId: event.externalId,
        sessionId: event.sessionId,
        code: error.code || error.name || 'unknown',
        message: error.message || 'Unknown error',
      });
      try {
        this.store.failWebhookEvent(PROVIDER, event.externalId, error.message || 'Unknown error');
      } catch (statusError) {
        this.logger.error?.(`[zalo] failure status failed: ${statusError.code || statusError.name || 'unknown'}`);
      }
      this.logger.error?.(`[zalo] event failed: ${error.code || error.name || 'unknown'}`);
      if (replySent) return;
      try {
        this.logger.warn?.('[zalo] fallback reply start', {
          chatId: event.chatId,
        });
        await this.zaloClient.sendMessage(event.chatId, FAILURE_REPLY);
        this.logger.info?.('[zalo] fallback reply sent', {
          chatId: event.chatId,
        });
      } catch (sendError) {
        this.logger.error?.(`[zalo] fallback reply failed: ${sendError.code || sendError.name || 'unknown'}`);
      }
    }
  }

  async waitForIdle(sessionId) {
    if (sessionId) {
      while (this.queueTails.has(sessionId)) {
        await this.queueTails.get(sessionId).catch(() => {});
      }
      return;
    }
    while (this.queueTails.size > 0) {
      await Promise.allSettled([...this.queueTails.values()]);
    }
  }
}
