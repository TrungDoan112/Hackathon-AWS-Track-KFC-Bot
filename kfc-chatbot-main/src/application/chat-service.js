import { run } from '@openai/agents';
import { createKfcAgent } from '../agent/kfc-agent.js';

export class SessionBusyError extends Error {
  constructor(sessionId) {
    super(`Session ${sessionId} đang xử lý một tin nhắn khác.`);
    this.name = 'SessionBusyError';
    this.code = 'SESSION_BUSY';
    this.status = 409;
  }
}

// Thrown (not returned as an empty string) so callers can distinguish
// "handed off to a human, no bot reply expected" from a genuine agent
// failure — an empty/falsy reply would otherwise trip zalo-webhook-service's
// FAILURE_REPLY fallback and send the customer an unwanted message.
export class HandoffMutedError extends Error {
  constructor(sessionId) {
    super(`Session ${sessionId} đang được nhân viên tiếp quản, bot không trả lời.`);
    this.name = 'HandoffMutedError';
    this.code = 'HANDOFF_MUTED';
    this.status = 200;
  }
}

export class ChatService {
  constructor({ store, model }) {
    this.store = store;
    this.model = model;
    this.activeSessions = new Set();
  }

  isBusy(sessionId) {
    return this.activeSessions.has(sessionId);
  }

  async chat({ sessionId, userId, message, zaloChatId, emit }) {
    if (this.isBusy(sessionId)) throw new SessionBusyError(sessionId);
    if (!process.env.OPENAI_API_KEY) {
      const error = new Error('OPENAI_API_KEY chưa được cấu hình trong .env.');
      error.code = 'OPENAI_KEY_MISSING';
      error.status = 503;
      throw error;
    }

    this.activeSessions.add(sessionId);
    try {
      const session = this.store.ensureSession(sessionId, userId);
      if (zaloChatId) this.store.setZaloChatId(sessionId, zaloChatId);
      this.store.addMessage(sessionId, 'user', message);
      emit('session', { sessionId, userId, model: this.model });

      if (this.store.getControlMode(sessionId) === 'human') {
        emit('handoff', { sessionId, reason: 'human_controlled' });
        throw new HandoffMutedError(sessionId);
      }

      const agent = createKfcAgent({
        store: this.store,
        sessionId,
        userId,
        emit,
        model: this.model,
      });
      const options = {
        stream: true,
        maxTurns: 12,
        toolExecution: { maxFunctionToolConcurrency: 1 },
      };
      if (session.lastResponseId) options.previousResponseId = session.lastResponseId;

      const stream = await run(agent, message, options);
      let streamedText = '';
      const textStream = stream.toTextStream({ compatibleWithNodeStreams: true });
      for await (const chunk of textStream) {
        const delta = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (!delta) continue;
        streamedText += delta;
        emit('assistant.delta', { delta });
      }
      await stream.completed;

      if (this.store.getControlMode(sessionId) === 'human') {
        emit('handoff', { sessionId, reason: 'human_controlled_mid_generation' });
        throw new HandoffMutedError(sessionId);
      }

      const finalOutput = typeof stream.finalOutput === 'string'
        ? stream.finalOutput
        : streamedText || JSON.stringify(stream.finalOutput ?? '');
      const responseText = finalOutput.trim() || streamedText.trim();
      if (responseText) this.store.addMessage(sessionId, 'assistant', responseText);
      if (stream.lastResponseId) this.store.saveLastResponseId(sessionId, stream.lastResponseId);

      emit('assistant.completed', { text: responseText });
      emit('done', {
        sessionId,
        responseId: stream.lastResponseId || null,
        dashboardUrl: `/dashboard?sessionId=${encodeURIComponent(sessionId)}`,
      });
      return responseText;
    } catch (error) {
      if (!(error instanceof HandoffMutedError) && this.store.getSession(sessionId)) {
        this.store.recordAgentError(sessionId, error.message);
      }
      throw error;
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }
}
